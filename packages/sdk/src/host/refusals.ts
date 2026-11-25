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
 *
 * The caller chooses the method, the action type and its client id, so two
 * things are bounded (@cto ae379641): every value is escaped, so none can end
 * the line or forge a field, and the windows are capped, so a run of distinct
 * method names cannot write a line each or grow the map without end.
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
/** The windows one principal may hold before its refusals count into its `method=*` window. */
export const REFUSAL_WINDOWS_PER_PRINCIPAL = 20;
/**
 * The windows the host holds at most, before every principal's refusals count
 * into its `method=*` window. Those add at most one per principal, and
 * principals are the host's configured plugins and users, not a caller's choice.
 */
export const REFUSAL_WINDOWS = 1_000;
/** The characters of one value a line keeps. */
export const REFUSAL_VALUE_CHARS = 200;

/** The method a principal's refusals count under past either cap. */
const ANY = '*';

/** One (principal, method)'s current minute. */
interface Window {
  readonly principal: string;
  /** Whether it counts toward its principal's cap: every window but the principal's `method=*` one. */
  readonly counted: boolean;
  /** The refusals inside it that were not written. */
  suppressed: number;
  /** The last refusal of them, which the closing line names. */
  last: GrantRefusal;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One value, as a line can hold it: cut to its first 200 characters, then each
 * control character, space, `=` and backslash as `\xNN`, so a value can neither
 * end the line nor read as another field.
 */
export const escapeValue = (value: string): string => [...value.slice(0, REFUSAL_VALUE_CHARS)]
  .map((one) => {
    const code = one.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || one === ' ' || one === '=' || one === '\\'
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : one;
  })
  .join('');

const line = (refusal: GrantRefusal, suppressed = 0): string =>
  `grant refused: principal=${escapeValue(refusal.principal)} method=${escapeValue(refusal.method)}`
  + ` needs=${escapeValue(refusal.needs)} conn=${escapeValue(refusal.conn)}`
  + (suppressed > 0 ? ` (${suppressed} more suppressed)` : '');

/** A host's refusal log: `refused` for each refusal, `close` when the host closes. */
export interface GrantRefusals {
  refused(refusal: GrantRefusal): void;
  /** How many windows are open now, which the caps bound. */
  open(): number;
  /** Writes what is still counted and stops every timer. */
  close(): void;
}

export function grantRefusals(log: Logger): GrantRefusals {
  const windows = new Map<string, Window>();
  /** Each principal's open windows other than its `method=*` one. */
  const held = new Map<string, number>();
  const keyOf = (principal: string, method: string): string => `${principal}\u0000${method}`;
  const end = (key: string): void => {
    const open = windows.get(key);
    if (open === undefined) return;
    windows.delete(key);
    clearTimeout(open.timer);
    if (open.counted) {
      const count = (held.get(open.principal) ?? 1) - 1;
      if (count > 0) held.set(open.principal, count);
      else held.delete(open.principal);
    }
    if (open.suppressed > 0) log.warn(line(open.last, open.suppressed));
  };
  const start = (key: string, refusal: GrantRefusal, counted: boolean): void => {
    log.warn(line(refusal));
    const timer = setTimeout(() => { end(key); }, REFUSAL_WINDOW_MS);
    // A minute of counting never keeps a daemon's process alive.
    (timer as { unref?: () => void }).unref?.();
    windows.set(key, { principal: refusal.principal, counted, suppressed: 0, last: refusal, timer });
    if (counted) held.set(refusal.principal, (held.get(refusal.principal) ?? 0) + 1);
  };
  return {
    refused(refusal) {
      const key = keyOf(refusal.principal, refusal.method);
      const open = windows.get(key);
      if (open !== undefined) {
        open.suppressed += 1;
        open.last = refusal;
        return;
      }
      const full = (held.get(refusal.principal) ?? 0) >= REFUSAL_WINDOWS_PER_PRINCIPAL || windows.size >= REFUSAL_WINDOWS;
      if (!full) {
        start(key, refusal, true);
        return;
      }
      // Past a cap: one window for the principal, whatever the method.
      const any = keyOf(refusal.principal, ANY);
      const pooled = windows.get(any);
      const named = { ...refusal, method: ANY };
      if (pooled !== undefined) {
        pooled.suppressed += 1;
        pooled.last = named;
        return;
      }
      start(any, named, false);
    },
    open: () => windows.size,
    close() {
      for (const key of [...windows.keys()]) end(key);
    },
  };
}

/**
 * The grant a command's -32009 names, read from `refusalReason`'s words
 * (`<id> may not <grant> here`); any other -32009 - a token that cannot be
 * minted, an owner who has not signed in - is its own message, escaped and cut
 * as every value is.
 */
export const refusedGrant = (message: string): string => /^\S+ may not (\S+) here$/.exec(message)?.[1] ?? message;

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
