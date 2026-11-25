/**
 * The check that a connected client is still there, VS Code's
 * `ProtocolLivenessMonitor`.
 *
 * A client that sends nothing for `pingIntervalMs` is sent a `ping`, and one
 * still silent `timeoutMs` later is closed. Any inbound data resets the wait.
 * A host under load defers the close and gives the client a fresh window, so a
 * stall of this process is not taken for a silent client.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/protocolLivenessMonitor.ts
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L153-L154
 */
import type { Peer } from './types/rpc.js';

/** How long a client may be silent before it is pinged, VS Code's `CLIENT_PING_INTERVAL`. */
export const CLIENT_PING_INTERVAL = 10_000;
/** How long a pinged client may stay silent before it is closed, VS Code's `CLIENT_LIVENESS_TIMEOUT`. */
export const CLIENT_LIVENESS_TIMEOUT = 20_000;

/** Whether this process is busy, as the monitor asks before it closes a client. */
export interface LoadEstimator {
  hasHighLoad(): boolean;
}

/** What the monitor is told to do and asked. */
export interface LivenessOptions {
  pingIntervalMs: number;
  timeoutMs: number;
  loadEstimator?: LoadEstimator;
  /** Whether the connection is checked now: a client that has not greeted the host is not. */
  canCheck: () => boolean;
  onPing: () => void;
  onTimeout: (silenceMs: number) => void;
  onDeferred?: (durationMs: number) => void;
  /** The clock, which a test replaces. */
  now?: () => number;
}

/**
 * Counts how many of the last ten seconds a one-second timer ran in, VS Code's
 * `LoadEstimator`: half of them missed is high load.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/base/parts/ipc/common/ipc.net.ts#L742-L787
 */
class TimerLoadEstimator implements LoadEstimator {
  private static readonly HISTORY_LENGTH = 10;
  private readonly lastRuns: number[] = [];

  constructor() {
    const now = Date.now();
    for (let at = 0; at < TimerLoadEstimator.HISTORY_LENGTH; at++) this.lastRuns[at] = now - 1000 * at;
    const timer = setInterval(() => {
      for (let at = TimerLoadEstimator.HISTORY_LENGTH; at >= 1; at--) this.lastRuns[at] = this.lastRuns[at - 1] as number;
      this.lastRuns[0] = Date.now();
    }, 1000);
    timer.unref?.();
  }

  hasHighLoad(): boolean {
    const now = Date.now();
    const limit = (1 + TimerLoadEstimator.HISTORY_LENGTH) * 1000;
    let score = 0;
    for (let at = 0; at < TimerLoadEstimator.HISTORY_LENGTH; at++) if (now - (this.lastRuns[at] as number) <= limit) score++;
    return 1 - score / TimerLoadEstimator.HISTORY_LENGTH >= 0.5;
  }
}

let shared: LoadEstimator | undefined;
/** The process's one estimator, started on first use. */
const sharedLoadEstimator = (): LoadEstimator => (shared ??= new TimerLoadEstimator());

/** A timer that may be set again before it fires, and does not keep the process alive. */
const timer = () => {
  let held: ReturnType<typeof setTimeout> | undefined;
  return {
    set(run: () => void, ms: number): void {
      if (held !== undefined) clearTimeout(held);
      held = setTimeout(() => { held = undefined; run(); }, ms);
      held.unref?.();
    },
    cancel(): void {
      if (held !== undefined) clearTimeout(held);
      held = undefined;
    },
  };
};

/** Probes an idle client and times out its continued silence. */
export class LivenessMonitor {
  private readonly ping = timer();
  private readonly close = timer();
  private readonly options: LivenessOptions;
  private readonly load: LoadEstimator;
  private readonly now: () => number;
  private deferredSince: number | undefined;
  private lastRead: number;

  constructor(options: LivenessOptions) {
    this.options = options;
    this.load = options.loadEstimator ?? sharedLoadEstimator();
    this.now = options.now ?? Date.now;
    this.lastRead = this.now();
  }

  /** Data came in: the wait starts again. */
  recordInboundTraffic(): void {
    this.lastRead = this.now();
    this.reset();
  }

  /** Starts the wait again, where the connection is checked now. */
  reset(): void {
    this.stop();
    if (this.options.canCheck()) this.arm();
  }

  /** Cancels both timers. */
  stop(): void {
    this.ping.cancel();
    this.close.cancel();
    this.deferredSince = undefined;
  }

  private arm(): void {
    this.ping.set(() => { this.onPingTimer(); }, this.options.pingIntervalMs);
    this.close.set(() => { this.onCloseTimer(); }, this.options.pingIntervalMs + this.options.timeoutMs);
  }

  private onPingTimer(): void {
    if (this.options.canCheck()) this.options.onPing();
  }

  private onCloseTimer(): void {
    if (!this.options.canCheck()) return;
    if (this.load.hasHighLoad()) {
      this.deferredSince ??= this.now();
      this.options.onDeferred?.(this.now() - this.deferredSince);
      this.ping.set(() => { this.onPingTimer(); }, this.options.pingIntervalMs);
      this.close.set(() => { this.onCloseTimer(); }, this.options.pingIntervalMs);
      return;
    }
    if (this.deferredSince !== undefined) {
      this.deferredSince = undefined;
      this.arm();
      return;
    }
    this.options.onTimeout(this.now() - this.lastRead);
  }
}

/** The first frames of a client that greets the host, as a cheap test of the raw text. */
const GREETING = /"method"\s*:\s*"(?:initialize|reconnect)"/;

/**
 * The monitor of one socket, as the listener wires it.
 *
 * The client is checked from its `initialize` or `reconnect` on, as VS Code
 * checks a connection from its handshake. The ping is a request `ping` on the
 * root channel, which a client answers or refuses: either is data.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L859-L875
 */
export const watchClient = (
  peer: Pick<Peer, 'request'>, socket: { close(): void; isOpen(): boolean }, options: Partial<LivenessOptions> = {},
): { heard(text: string): void; stop(): void } => {
  let greeted = false;
  const monitor = new LivenessMonitor({
    pingIntervalMs: CLIENT_PING_INTERVAL,
    timeoutMs: CLIENT_LIVENESS_TIMEOUT,
    canCheck: () => greeted && socket.isOpen(),
    onPing: () => { void peer.request('ping', { channel: 'ahp-root://' }, CLIENT_LIVENESS_TIMEOUT).catch(() => { /* silence is what the close timer measures */ }); },
    onTimeout: () => { socket.close(); },
    ...options,
  });
  return {
    heard: (text) => {
      if (!greeted && GREETING.test(text)) greeted = true;
      monitor.recordInboundTraffic();
    },
    stop: () => { monitor.stop(); },
  };
};
