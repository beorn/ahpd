import type { Logger } from '../log.js';

/**
 * The host's own account of a grant it refused.
 *
 * A refusal used to reach only the caller: the host wrote nothing, so a plugin
 * held to its grants (#38446) or a person refused an operation left no trace on
 * the machine it was refused on - a silent error on the host (@cto ab54193c).
 * Each refusal is one warn line,
 *
 *   grant refused: principal=<plugin:name|user:id> method=<m> needs=<grant> conn=<id>
 *
 * and a caller that keeps asking cannot flood the log: per (principal, method)
 * the first refusal is written at once, the rest inside the next minute are
 * counted, and when that minute ends one line says how many were not written.
 * A refusal after a quiet minute starts over and is written at once.
 */
export interface GrantRefusal {
  /** Who was refused: `plugin:<name>`, `user:<id>`, or what the connection is known as. */
  readonly principal: string;
  /** The command, or the action type, that was refused. */
  readonly method: string;
  /** The grant it needed and did not hold. */
  readonly needs: string;
  /** The connection's client id, or `-` before it has said one. */
  readonly conn: string;
}

/** How long one (principal, method) writes at most one line. */
export const REFUSAL_WINDOW_MS = 60_000;

/** One (principal, method)'s current minute. */
interface Window {
  /** The refusals inside it that were not written. */
  suppressed: number;
  /** The last refusal of them, which the closing line names. */
  last: GrantRefusal;
  timer: ReturnType<typeof setTimeout>;
}

const line = (refusal: GrantRefusal, suppressed = 0): string =>
  `grant refused: principal=${refusal.principal} method=${refusal.method} needs=${refusal.needs} conn=${refusal.conn}`
  + (suppressed > 0 ? ` (${suppressed} more suppressed)` : '');

/** A host's refusal log: `refused` for each refusal, `close` when the host closes. */
export interface GrantRefusals {
  refused(refusal: GrantRefusal): void;
  /** Writes what is still counted and stops every timer. */
  close(): void;
}

export function grantRefusals(log: Logger): GrantRefusals {
  const windows = new Map<string, Window>();
  const end = (key: string): void => {
    const open = windows.get(key);
    if (open === undefined) return;
    windows.delete(key);
    clearTimeout(open.timer);
    if (open.suppressed > 0) log.warn(line(open.last, open.suppressed));
  };
  return {
    refused(refusal) {
      const key = `${refusal.principal}\u0000${refusal.method}`;
      const open = windows.get(key);
      if (open !== undefined) {
        open.suppressed += 1;
        open.last = refusal;
        return;
      }
      log.warn(line(refusal));
      const timer = setTimeout(() => { end(key); }, REFUSAL_WINDOW_MS);
      // A minute of counting never keeps a daemon's process alive.
      (timer as { unref?: () => void }).unref?.();
      windows.set(key, { suppressed: 0, last: refusal, timer });
    },
    close() {
      for (const key of [...windows.keys()]) end(key);
    },
  };
}

/** One per log, so every connection of a host counts against the same minute. */
const byLog = new WeakMap<Logger, GrantRefusals>();

/** The refusal log of the host that writes to `log`. */
export const refusalsOf = (log: Logger): GrantRefusals => {
  const known = byLog.get(log);
  if (known !== undefined) return known;
  const made = grantRefusals(log);
  byLog.set(log, made);
  return made;
};
