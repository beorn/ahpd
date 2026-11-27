/**
 * The systemd --user arm of the services driver (#38277, @cto: "the second
 * driver proves the interface"). Same `Driver`, same `Machine`; only the
 * backend differs.
 *
 * It does what a customer install's boot item needs (#38280) and nothing more:
 *
 * - `put` writes `<unitDir>/<name>.service` from the neutral record;
 * - `start` is `systemctl --user enable --now <name>.service` and `stop` is
 *   `systemctl --user disable --now <name>.service`, because a user unit here is
 *   a boot item: starting it means starting it at every login too;
 * - `remove` deletes the unit file. It runs no systemctl: a caller stops it first.
 *
 * Everything else (`list`, `logs`, `acknowledge`, `changes`, `restart`) is
 * refused by name, NOT_SUPPORTED. There is no read side, so a put writes the
 * whole unit from the record it is given: a field left out is left out of the
 * unit, never merged from the file. `ifVersion` is the sha256 of the unit file's
 * text, or `"absent"` to create only, as in the process-compose arm.
 *
 * Every effect (the unit file, the change log, systemctl) goes through the
 * backend's `host`, so a test or the installer holds them all. Like the
 * process-compose arm it answers refusals, never throws. The functions are
 * synchronous (the host is): `DRIVER.put`, `remove` and `control` hand a
 * systemd-user machine to them, and the installer, whose uninstall is
 * synchronous, calls them directly.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Answer, Caller, LogLine, Machine, PutParams, Refusal, RefusalCode } from './compose.js';
import { applyPatch, checkPatch, type ServiceRecord } from './record.js';
import { REMOTE_COMMANDS_OFF, machineSwitches } from './switches.js';

/** One command's answer: its exit code and what it printed. */
export interface UnitRun {
  readonly code: number;
  readonly output: string;
}

/** Every effect the systemd-user arm has. */
export interface UnitHost {
  /** The file's text, or `undefined` when there is none. */
  readonly read: (path: string) => string | undefined;
  /** Replace the file's text, making its directory when there is none. */
  readonly write: (path: string, text: string) => void;
  readonly remove: (path: string) => void;
  /** Add text to the end of the file, making it and its directory when there are none. */
  readonly append: (path: string, text: string) => void;
  /** Run one program with exactly these words: no shell between. */
  readonly run: (argv: readonly string[]) => UnitRun;
}

/** A machine whose services are systemd user units in `unitDir`. */
export interface SystemdUserBackend {
  readonly kind: 'systemd-user';
  readonly unitDir: string;
  readonly host: UnitHost;
}

/** A machine under systemd --user. */
export type SystemdMachine = Machine & { readonly backend: SystemdUserBackend };

const ABSENT = 'absent';

const refuse = (code: RefusalCode, message: string, output?: string): Refusal =>
  (output === undefined ? { ok: false, code, message } : { ok: false, code, message, output });

const failed = (error: unknown): Refusal =>
  refuse('DRIVER_FAILED', `services driver failed: ${error instanceof Error ? error.message : String(error)}`);

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A driver method this arm does not carry, refused by its own name. */
export const unsupported = (method: string, machine: Machine): Refusal =>
  refuse('NOT_SUPPORTED', `${method} is not supported by the systemd-user driver on ${machine.name}`);

const unitOf = (name: string): string => `${name}.service`;

const log = (machine: SystemdMachine, line: Omit<LogLine, 'at'>): void => {
  machine.backend.host.append(machine.changeLog, `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`);
};

/** systemd's `Restart=` word for each neutral policy it has one for; `exit_on_failure` has none. */
const RESTART: Readonly<Record<string, string>> = { always: 'always', on_failure: 'on-failure', no: 'no' };

/** The fields a unit carries; every other neutral field is refused by name rather than dropped. */
const CARRIED = new Set(['name', 'command', 'restart']);

/**
 * The unit text for a record, or why this arm cannot write it. `command` is
 * ExecStart's value as systemd reads it (words split on spaces, `"` quotes),
 * not a shell line: the caller quotes for systemd.
 */
export function unitText(machine: Pick<Machine, 'name'>, record: ServiceRecord): Answer<{ text: string }> {
  for (const [field, value] of Object.entries(record)) {
    if (value !== undefined && !CARRIED.has(field)) return refuse('NOT_SUPPORTED', `${field} is not supported by the systemd-user driver on ${machine.name}`);
  }
  if (/[\r\n]/u.test(record.command)) return refuse('INVALID', 'command holds a line break, which would end ExecStart= in the unit');
  const lines = ['[Unit]', `Description=${record.name}`, '', '[Service]', `ExecStart=${record.command}`];
  if (record.restart !== undefined) {
    const word = RESTART[record.restart.policy];
    if (word === undefined) return refuse('NOT_SUPPORTED', `restart policy ${record.restart.policy} is not supported by the systemd-user driver on ${machine.name}`);
    if (record.restart.max_restarts !== undefined) return refuse('NOT_SUPPORTED', `restart.max_restarts is not supported by the systemd-user driver on ${machine.name}`);
    lines.push(`Restart=${word}`);
    if (record.restart.backoff_seconds !== undefined) lines.push(`RestartSec=${String(record.restart.backoff_seconds)}`);
  }
  // `WantedBy` alone: pairing it with `After=default.target` is the ordering cycle systemd warns about.
  lines.push('', '[Install]', 'WantedBy=default.target', '');
  return { ok: true, text: lines.join('\n') };
}

/** `put`: write one unit from the record, pinned to the unit's version as the caller read it. */
export function putUnit(machine: SystemdMachine, caller: Caller, params: PutParams): Answer<{ ifVersion: string; file: string; service: ServiceRecord; changed: boolean }> {
  const name = typeof params?.service?.name === 'string' ? params.service.name : '';
  const { host, unitDir } = machine.backend;
  let intended: ServiceRecord | null = null;
  let hashBefore: string | null = null;
  const done = (refusal: Refusal): Refusal => {
    try {
      log(machine, { principal: caller.principal, op: 'put', name, before: null, after: intended, fileHashBefore: hashBefore, fileHashAfter: hashBefore, refused: { code: refusal.code, message: refusal.message } });
    }
    catch { /* the refusal still reaches the caller */ }
    return refusal;
  };
  try {
    const invalid = checkPatch(params?.service);
    if (invalid) return done(refuse(invalid.code, invalid.message));
    const file = join(unitDir, unitOf(name));
    const now = host.read(file);
    hashBefore = now === undefined ? null : sha256(now);
    if (params.service.command === undefined) return done(refuse('INVALID', `${name}: a put on the systemd-user driver writes the whole unit, so it needs a command`));
    const after = applyPatch(undefined, params.service);
    intended = after;
    if (params.ifVersion === ABSENT && now !== undefined) return done(refuse('EXISTS', `${file} already exists on ${machine.name}; a create-only put never overwrites`));
    if (params.ifVersion !== ABSENT && params.ifVersion !== hashBefore) {
      return done(refuse('STALE_VERSION', `${file} is ${hashBefore === null ? 'absent' : `now ${hashBefore}`}, not version ${String(params.ifVersion)}; nothing was written; read it again`));
    }
    if (caller.remote) {
      let allowed: boolean;
      try {
        allowed = machineSwitches(machine.configDir).allowRemoteCommands;
      }
      catch (error) {
        return done(refuse('SWITCHES_UNREADABLE', (error as Error).message));
      }
      if (!allowed) return done(refuse('REMOTE_COMMANDS_OFF', REMOTE_COMMANDS_OFF));
    }
    const unit = unitText(machine, after);
    if (!unit.ok) return done(unit);
    const changed = unit.text !== now;
    if (changed) host.write(file, unit.text);
    const hashAfter = sha256(unit.text);
    log(machine, { principal: caller.principal, op: 'put', name, before: null, after, fileHashBefore: hashBefore, fileHashAfter: hashAfter });
    return { ok: true, ifVersion: hashAfter, file, service: after, changed };
  }
  catch (error) {
    return done(failed(error));
  }
}

/** `remove`: delete one unit file, pinned to its version. It runs no systemctl; stop the unit first. */
export function removeUnit(machine: SystemdMachine, caller: Caller, params: { readonly name: string; readonly ifVersion: string }): Answer<{ ifVersion: string; file: string }> {
  const name = typeof params?.name === 'string' ? params.name : '';
  const { host, unitDir } = machine.backend;
  let hashBefore: string | null = null;
  const done = (refusal: Refusal): Refusal => {
    try {
      log(machine, { principal: caller.principal, op: 'remove', name, before: null, after: null, fileHashBefore: hashBefore, fileHashAfter: hashBefore, refused: { code: refusal.code, message: refusal.message } });
    }
    catch { /* the refusal still reaches the caller */ }
    return refusal;
  };
  try {
    if (checkPatch({ name }) !== undefined) return done(refuse('INVALID', 'name must be a service name'));
    const file = join(unitDir, unitOf(name));
    const now = host.read(file);
    if (now === undefined) return done(refuse('NOT_FOUND', `${file} is not a unit on ${machine.name}`));
    hashBefore = sha256(now);
    if (params.ifVersion !== hashBefore) return done(refuse('STALE_VERSION', `${file} is now ${hashBefore}, not version ${String(params.ifVersion)}; nothing was removed; read it again`));
    host.remove(file);
    log(machine, { principal: caller.principal, op: 'remove', name, before: null, after: null, fileHashBefore: hashBefore, fileHashAfter: null });
    return { ok: true, ifVersion: ABSENT, file };
  }
  catch (error) {
    return done(failed(error));
  }
}

/** `start` enables and starts the unit, `stop` disables and stops it; `restart` is refused. */
export function controlUnit(machine: SystemdMachine, caller: Caller, params: { readonly name: string; readonly verb: 'start' | 'stop' | 'restart' }): Answer<{ name: string; output?: string }> {
  const name = typeof params?.name === 'string' ? params.name : '';
  const verb = params?.verb;
  const line = (refused?: Refusal): void => log(machine, {
    principal: caller.principal, op: String(verb), name, before: null, after: null, fileHashBefore: null, fileHashAfter: null,
    ...(refused ? { refused: { code: refused.code, message: refused.message } } : {}),
  });
  const said = (refusal: Refusal): Refusal => {
    try { line(refusal); } catch { /* the refusal still reaches the caller */ }
    return refusal;
  };
  try {
    if (verb === 'restart') return said(unsupported('restart', machine));
    if (verb !== 'start' && verb !== 'stop') return said(refuse('INVALID', `verb must be start or stop, not ${String(verb)}`));
    if (checkPatch({ name }) !== undefined) return said(refuse('INVALID', 'name must be a service name'));
    const argv = ['systemctl', '--user', verb === 'start' ? 'enable' : 'disable', '--now', unitOf(name)];
    const ran = machine.backend.host.run(argv);
    if (ran.code !== 0) return said(refuse('SYSTEMCTL_REFUSED', `${verb} ${name} on ${machine.name}: ${argv.join(' ')} exited ${String(ran.code)}: ${ran.output}`, ran.output));
    line();
    return { ok: true, name, output: ran.output };
  }
  catch (error) {
    return said(failed(error));
  }
}
