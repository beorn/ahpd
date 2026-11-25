import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_LIVENESS_TIMEOUT, CLIENT_PING_INTERVAL, LivenessMonitor, watchClient } from '../src/liveness.js';

/*
 * The check that a client is still there, with VS Code's timings: a ping after
 * 10 s of silence, and a close 20 s after it.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/protocolLivenessMonitor.ts
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const calm = { hasHighLoad: () => false };

/** A socket the monitor watches, recording what it is sent and whether it was closed. */
const socket = () => {
  const pinged: unknown[] = [];
  let open = true;
  const peer = { request: (method: string, params: unknown) => { pinged.push({ method, params }); return new Promise<unknown>(() => {}); } };
  const wire = { close: () => { open = false; }, isOpen: () => open };
  return { pinged, peer, wire, closed: () => !open };
};

describe('a client the host watches', () => {
  it('pings a greeted client after 10 s of silence, and closes it 20 s later', () => {
    const one = socket();
    const alive = watchClient(one.peer, one.wire, { loadEstimator: calm });
    alive.heard('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    vi.advanceTimersByTime(CLIENT_PING_INTERVAL - 1);
    expect(one.pinged).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(one.pinged).toEqual([{ method: 'ping', params: { channel: 'ahp-root://' } }]);
    vi.advanceTimersByTime(CLIENT_LIVENESS_TIMEOUT - 1);
    expect(one.closed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(one.closed()).toBe(true);
  });

  it('starts the wait again on any data, so an answered ping keeps the client', () => {
    const one = socket();
    const alive = watchClient(one.peer, one.wire, { loadEstimator: calm });
    alive.heard('{"jsonrpc":"2.0","id":1,"method":"reconnect","params":{}}');
    vi.advanceTimersByTime(CLIENT_PING_INTERVAL + 5_000);
    expect(one.pinged).toHaveLength(1);
    alive.heard('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"no"}}');
    vi.advanceTimersByTime(CLIENT_LIVENESS_TIMEOUT);
    expect(one.closed()).toBe(false);
    expect(one.pinged).toHaveLength(2);
  });

  it('leaves a client alone until it greets the host, and after the socket closes', () => {
    const one = socket();
    const alive = watchClient(one.peer, one.wire, { loadEstimator: calm });
    alive.heard('{"jsonrpc":"2.0","method":"unsubscribe","params":{}}');
    vi.advanceTimersByTime(60_000);
    expect(one.pinged).toEqual([]);
    expect(one.closed()).toBe(false);
    alive.heard('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
    alive.stop();
    vi.advanceTimersByTime(60_000);
    expect(one.pinged).toEqual([]);
  });
});

describe('a host under load', () => {
  it('defers the close while busy, then gives the client a fresh window', () => {
    let busy = true;
    const timedOut: number[] = [];
    const deferred: number[] = [];
    const monitor = new LivenessMonitor({
      pingIntervalMs: 10, timeoutMs: 20, loadEstimator: { hasHighLoad: () => busy },
      canCheck: () => true, onPing: () => {}, onTimeout: (ms) => { timedOut.push(ms); }, onDeferred: (ms) => { deferred.push(ms); },
    });
    monitor.recordInboundTraffic();
    vi.advanceTimersByTime(30);
    vi.advanceTimersByTime(10);
    expect(deferred).toEqual([0, 10]);
    expect(timedOut).toEqual([]);
    busy = false;
    vi.advanceTimersByTime(10);
    expect(timedOut).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(timedOut).toHaveLength(1);
  });
});
