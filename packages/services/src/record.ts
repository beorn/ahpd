/**
 * The neutral service record, and its mapping to and from a process-compose
 * entry (#38277).
 *
 * The neutral record is the only shape Hightea sees. It names the fields every
 * supervisor the driver may later speak to can carry; everything else in a
 * process-compose entry is native and is never read, written or dropped here.
 *
 * Secrets: process-compose starts, restarts and schedules programs itself, so
 * ahpd cannot hand a value in at each start (@cto, wrapper option). A service
 * with `env` is written with the wrapper as its native command:
 *
 *     ahpd secrets exec <service> --env KEY=<scope>:<name> ... -- '<command>'
 *
 * The references travel in the wrapper's own arguments, so the wrapper needs
 * nothing but its argv and the vault, and the native file never holds a value.
 * The command is one single-quoted shell word that the wrapper runs with the
 * shell, so `a && b` stays one program under the wrapper rather than being
 * split by process-compose's own shell. On read the wrapper is mapped back to
 * the neutral `command` and `env`; a wrapper not in exactly this form is not
 * something the driver wrote, and that entry is read-only.
 */

/** A reference into the machine's vault; the only form an `env` value may take. */
export interface SecretRef {
  readonly $secret: string;
}

/** process-compose's `availability.restart` values. */
export const RESTART_POLICIES = ['always', 'on_failure', 'exit_on_failure', 'no'] as const;
export type RestartPolicy = (typeof RESTART_POLICIES)[number];

/** process-compose's `depends_on.<name>.condition` values. */
export const CONDITIONS = [
  'process_started',
  'process_healthy',
  'process_completed',
  'process_completed_successfully',
  'process_log_ready',
] as const;
export type Condition = (typeof CONDITIONS)[number];

/** When a scheduled program runs: exactly one of `cron` (five fields) or `interval` (a Go duration). */
export interface Schedule {
  readonly cron?: string;
  readonly interval?: string;
  readonly timezone?: string;
  readonly run_on_start?: boolean;
}

export interface Restart {
  readonly policy: RestartPolicy;
  readonly backoff_seconds?: number;
  readonly max_restarts?: number;
}

export interface Dependency {
  readonly name: string;
  readonly condition: Condition;
}

/** A readiness check: a command to run, or a URL to get. */
export type Health =
  | { readonly exec: string }
  | { readonly http: { readonly port: number; readonly host?: string; readonly path?: string; readonly scheme?: 'http' | 'https' } };

/** One service, as the driver reads it and Hightea sees it. */
export interface ServiceRecord {
  readonly name: string;
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, SecretRef>>;
  readonly schedule?: Schedule;
  readonly restart?: Restart;
  readonly depends_on?: readonly Dependency[];
  readonly health?: Health;
}

/**
 * A put: the name plus the fields it changes. A field left out is left as it
 * is; a field set to `null` is taken off the entry. `command` is required only
 * for a new entry.
 */
export interface ServicePatch {
  readonly name: string;
  readonly command?: string;
  readonly cwd?: string | null;
  readonly env?: Readonly<Record<string, SecretRef>> | null;
  readonly schedule?: Schedule | null;
  readonly restart?: Restart | null;
  readonly depends_on?: readonly Dependency[] | null;
  readonly health?: Health | null;
}

/** The neutral fields, in the order they are written; `list` answers them as the capability list. */
export const FIELDS = ['name', 'command', 'cwd', 'env', 'schedule', 'restart', 'depends_on', 'health'] as const;

/** The wrapper's fixed words. */
export const WRAPPER = 'ahpd secrets exec';

/** A name that is a plain YAML key, a plain shell word and a process-compose name, all at once. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** `<scope>:<name>`, from characters that need no quoting in the wrapper's argv. */
const REFERENCE = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_./@-]+$/;
const DURATION = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;
const NON_NEGATIVE = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Why a patch cannot be written, with the code the caller gets. */
export interface Invalid {
  readonly code: 'INVALID' | 'PLAIN_ENV_VALUE';
  readonly message: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a patch is one the driver will write, or the first reason it is not.
 *
 * Every refusal names the field. A plain `env` value is refused on its own
 * code, by key, and its value is never echoed: it is very likely the secret.
 * `{{` is refused in any string because process-compose would template it,
 * and the entry would then read back as one the driver cannot edit.
 */
export function checkPatch(patch: unknown): Invalid | undefined {
  const bad = (message: string): Invalid => ({ code: 'INVALID', message });
  if (!isObject(patch)) return bad('a service must be an object');
  for (const key of Object.keys(patch)) {
    if (!(FIELDS as readonly string[]).includes(key)) return bad(`"${key}" is not a service field; the fields are ${FIELDS.join(', ')}`);
  }
  const { name, command, cwd, env, schedule, restart, depends_on: depends, health } = patch;
  if (typeof name !== 'string' || !SAFE_NAME.test(name)) return bad('name must be letters, digits, "_", "." or "-", starting with a letter or digit');
  const text = (field: string, value: unknown): Invalid | undefined => {
    if (typeof value !== 'string' || value.trim() === '') return bad(`${field} must be a non-empty string`);
    if (value.includes('{{')) return bad(`${field} holds "{{", which process-compose reads as a template`);
    return undefined;
  };
  if (command !== undefined) { const wrong = text('command', command); if (wrong) return wrong; }
  if (cwd !== undefined && cwd !== null) { const wrong = text('cwd', cwd); if (wrong) return wrong; }
  if (env !== undefined && env !== null) {
    if (!isObject(env)) return bad('env must be an object of NAME: {"$secret": "<scope>:<name>"}');
    for (const [key, value] of Object.entries(env)) {
      if (!VARIABLE.test(key)) return bad(`env name "${key}" is not a variable name`);
      const ref = isObject(value) && Object.keys(value).length === 1 ? value['$secret'] : undefined;
      if (typeof ref !== 'string') {
        return { code: 'PLAIN_ENV_VALUE', message: `env ${key} must be a secret reference {"$secret":"<scope>:<name>"}; a plain value is never written to the machine's file` };
      }
      if (!REFERENCE.test(ref)) return bad(`env ${key}: "${ref}" is not a reference of the form <scope>:<name>`);
    }
  }
  if (schedule !== undefined && schedule !== null) {
    if (!isObject(schedule)) return bad('schedule must be an object');
    for (const key of Object.keys(schedule)) {
      if (!['cron', 'interval', 'timezone', 'run_on_start'].includes(key)) return bad(`schedule.${key} is not a schedule field`);
    }
    const { cron, interval, timezone, run_on_start: onStart } = schedule;
    if ((cron === undefined) === (interval === undefined)) return bad('schedule needs exactly one of cron or interval');
    if (cron !== undefined && (typeof cron !== 'string' || cron.trim().split(/\s+/).length !== 5)) return bad('schedule.cron must be five cron fields');
    if (interval !== undefined && (typeof interval !== 'string' || !DURATION.test(interval))) return bad('schedule.interval must be a duration such as 90s, 5m or 1h30m');
    if (timezone !== undefined && (typeof timezone !== 'string' || timezone === '')) return bad('schedule.timezone must be a non-empty string');
    if (onStart !== undefined && typeof onStart !== 'boolean') return bad('schedule.run_on_start must be true or false');
  }
  if (restart !== undefined && restart !== null) {
    if (!isObject(restart)) return bad('restart must be an object');
    for (const key of Object.keys(restart)) {
      if (!['policy', 'backoff_seconds', 'max_restarts'].includes(key)) return bad(`restart.${key} is not a restart field`);
    }
    if (!(RESTART_POLICIES as readonly unknown[]).includes(restart['policy'])) return bad(`restart.policy must be one of ${RESTART_POLICIES.join(', ')}`);
    if (restart['backoff_seconds'] !== undefined && !NON_NEGATIVE(restart['backoff_seconds'])) return bad('restart.backoff_seconds must be a whole number of seconds');
    if (restart['max_restarts'] !== undefined && !NON_NEGATIVE(restart['max_restarts'])) return bad('restart.max_restarts must be a whole number');
  }
  if (depends !== undefined && depends !== null) {
    if (!Array.isArray(depends)) return bad('depends_on must be a list of {name, condition}');
    const seen = new Set<string>();
    for (const one of depends as unknown[]) {
      if (!isObject(one) || typeof one['name'] !== 'string' || !SAFE_NAME.test(one['name'])) return bad('depends_on: each entry needs a service name');
      if (!(CONDITIONS as readonly unknown[]).includes(one['condition'])) return bad(`depends_on ${one['name']}: condition must be one of ${CONDITIONS.join(', ')}`);
      if (seen.has(one['name'])) return bad(`depends_on names ${one['name']} twice`);
      seen.add(one['name']);
    }
  }
  if (health !== undefined && health !== null) {
    if (!isObject(health) || Object.keys(health).length !== 1) return bad('health must be {exec: "<command>"} or {http: {port, host?, path?, scheme?}}');
    if ('exec' in health) { const wrong = text('health.exec', health['exec']); if (wrong) return wrong; }
    else if (isObject(health['http'])) {
      const http = health['http'];
      for (const key of Object.keys(http)) {
        if (!['port', 'host', 'path', 'scheme'].includes(key)) return bad(`health.http.${key} is not an http check field`);
      }
      const port = http['port'];
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return bad('health.http.port must be a port number');
      for (const key of ['host', 'path'] as const) {
        if (http[key] !== undefined) { const wrong = text(`health.http.${key}`, http[key]); if (wrong) return wrong; }
      }
      if (http['scheme'] !== undefined && http['scheme'] !== 'http' && http['scheme'] !== 'https') return bad('health.http.scheme must be http or https');
    }
    else return bad('health must be {exec: "<command>"} or {http: {port, host?, path?, scheme?}}');
  }
  return undefined;
}

/** A patch laid over the record it changes (or over nothing, for a new entry). */
export function applyPatch(before: ServiceRecord | undefined, patch: ServicePatch): ServiceRecord {
  const merged: Record<string, unknown> = { ...(before ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  if (isObject(merged['env']) && Object.keys(merged['env']).length === 0) delete merged['env'];
  if (Array.isArray(merged['depends_on']) && merged['depends_on'].length === 0) delete merged['depends_on'];
  return merged as unknown as ServiceRecord;
}

const quoteWord = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** The native `command` for a neutral command and its references. */
export function nativeCommand(name: string, command: string, env: Readonly<Record<string, SecretRef>> | undefined): string {
  const refs = Object.entries(env ?? {});
  if (refs.length === 0) return command;
  return `${WRAPPER} ${name}${refs.map(([key, ref]) => ` --env ${key}=${ref.$secret}`).join('')} -- ${quoteWord(command)}`;
}

const WRAPPED = /^ahpd secrets exec (\S+)((?: --env [A-Za-z_][A-Za-z0-9_]*=\S+)*) -- '((?:[^']|'\\'')*)'$/;

/** The neutral command and references a native command carries, or why it is not the wrapper the driver writes. */
function neutralCommand(name: string, native: string): { command: string; env?: Record<string, SecretRef> } | string {
  if (!native.startsWith(`${WRAPPER} `)) return { command: native };
  const match = WRAPPED.exec(native);
  if (!match) return 'its command uses the secrets wrapper in a form the driver does not write';
  if (match[1] !== name) return `its secrets wrapper names the service ${match[1]}`;
  const env: Record<string, SecretRef> = {};
  for (const [, key, ref] of (match[2] ?? '').matchAll(/ --env ([A-Za-z_][A-Za-z0-9_]*)=(\S+)/g)) {
    if (!REFERENCE.test(ref!)) return `its secrets wrapper names "${ref}", which is not a reference`;
    env[key!] = { $secret: ref! };
  }
  return { command: (match[3] ?? '').replace(/'\\''/g, `'`), env };
}

/**
 * The neutral record of one process-compose entry, or the reason the driver
 * cannot read it faithfully (which makes it read-only).
 *
 * `entry` is the entry as plain data. Only the neutral fields are read; any
 * other key is native and is left to process-compose.
 */
export function fromNative(name: string, entry: unknown): ServiceRecord | string {
  if (!isObject(entry)) return 'it is not a mapping';
  if (entry['extends'] !== undefined) return 'it uses extends';
  if (entry['vars'] !== undefined) return 'it uses vars templating';
  for (const key of ['entrypoint', 'args', 'executable']) {
    if (entry[key] !== undefined) return `it uses ${key}`;
  }
  if (typeof entry['command'] !== 'string') return 'it has no command string';
  if (JSON.stringify(entry).includes('{{')) return 'it uses templated values';
  const command = neutralCommand(name, entry['command']);
  if (typeof command === 'string') return command;
  if (command.env === undefined && JSON.stringify(entry['environment'] ?? null).includes('$secret')) {
    return 'it uses $secret without the ahpd secrets wrapper';
  }
  const record: Record<string, unknown> = { name, command: command.command };
  if (command.env !== undefined && Object.keys(command.env).length > 0) record['env'] = command.env;

  const cwd = entry['working_dir'];
  if (cwd !== undefined && cwd !== null) {
    if (typeof cwd !== 'string') return 'its working_dir is not a string';
    record['cwd'] = cwd;
  }

  const schedule = entry['schedule'];
  if (schedule !== undefined && schedule !== null) {
    if (!isObject(schedule)) return 'its schedule is not a mapping';
    if (schedule['cron'] !== undefined && schedule['interval'] !== undefined) return 'its schedule sets both cron and interval';
    const out: Record<string, unknown> = {};
    for (const key of ['cron', 'interval', 'timezone'] as const) {
      if (schedule[key] === undefined) continue;
      if (typeof schedule[key] !== 'string') return `its schedule.${key} is not a string`;
      out[key] = schedule[key];
    }
    if (schedule['run_on_start'] !== undefined) {
      if (typeof schedule['run_on_start'] !== 'boolean') return 'its schedule.run_on_start is not true or false';
      out['run_on_start'] = schedule['run_on_start'];
    }
    if (out['cron'] === undefined && out['interval'] === undefined) return 'its schedule has neither cron nor interval';
    record['schedule'] = out;
  }

  const availability = entry['availability'];
  if (availability !== undefined && availability !== null) {
    if (!isObject(availability)) return 'its availability is not a mapping';
    const { restart, backoff_seconds: backoff, max_restarts: most } = availability;
    if (restart !== undefined || backoff !== undefined || most !== undefined) {
      if (restart === undefined) return 'its availability sets backoff or max_restarts without restart';
      if (!(RESTART_POLICIES as readonly unknown[]).includes(restart)) return `its availability.restart "${String(restart)}" is not one the driver knows`;
      if (backoff !== undefined && !NON_NEGATIVE(backoff)) return 'its availability.backoff_seconds is not a whole number';
      if (most !== undefined && !NON_NEGATIVE(most)) return 'its availability.max_restarts is not a whole number';
      record['restart'] = {
        policy: restart,
        ...(backoff === undefined ? {} : { backoff_seconds: backoff }),
        ...(most === undefined ? {} : { max_restarts: most }),
      };
    }
  }

  const depends = entry['depends_on'];
  if (depends !== undefined && depends !== null) {
    if (!isObject(depends)) return 'its depends_on is not a mapping';
    const out: Dependency[] = [];
    for (const [other, how] of Object.entries(depends)) {
      const condition = isObject(how) ? how['condition'] : undefined;
      if (!(CONDITIONS as readonly unknown[]).includes(condition)) return `its depends_on.${other} has no condition the driver knows`;
      out.push({ name: other, condition: condition as Condition });
    }
    if (out.length > 0) record['depends_on'] = out;
  }

  const probe = entry['readiness_probe'];
  if (probe !== undefined && probe !== null) {
    if (!isObject(probe)) return 'its readiness_probe is not a mapping';
    const exec = probe['exec'];
    const http = probe['http_get'];
    if (exec !== undefined && http !== undefined) return 'its readiness_probe sets both exec and http_get';
    if (isObject(exec) && typeof exec['command'] === 'string') record['health'] = { exec: exec['command'] };
    else if (isObject(http)) {
      if (http['num_port'] !== undefined) return 'its readiness_probe uses num_port';
      const port = typeof http['port'] === 'string' && /^\d+$/.test(http['port']) ? Number(http['port']) : http['port'];
      if (typeof port !== 'number' || !Number.isInteger(port)) return 'its readiness_probe.http_get.port is not a port number';
      const out: Record<string, unknown> = { port };
      for (const key of ['host', 'path', 'scheme'] as const) {
        if (http[key] === undefined) continue;
        if (typeof http[key] !== 'string') return `its readiness_probe.http_get.${key} is not a string`;
        out[key] = http[key];
      }
      if (out['scheme'] !== undefined && out['scheme'] !== 'http' && out['scheme'] !== 'https') return 'its readiness_probe.http_get.scheme is not http or https';
      record['health'] = { http: out };
    }
    else return 'its readiness_probe is neither an exec command nor an http_get';
  }
  return record as unknown as ServiceRecord;
}

/** Remove the native subtree at this path. */
export const REMOVE = Symbol('remove');
/** A native value: a scalar, or (for a new key) a mapping of them. */
export type NativeValue = string | number | boolean;
/** One native change: a path under the entry, and the scalar it becomes or REMOVE. */
export type NativeChange = readonly [readonly string[], NativeValue | typeof REMOVE];

/** Structural equality over the plain JSON a record is made of. */
export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The native changes that turn the entry `before` describes into `after`.
 *
 * Only a neutral field whose value differs contributes, and only the native
 * keys that field owns: `max_concurrent` beside a schedule, `exit_on_end`
 * beside a restart policy or the probe's timing beside its check are native
 * and are never named here, so they stay as they are. Taking a whole field off
 * (`schedule`, `health`, `depends_on`) removes its native key; a restart policy
 * removes only its own three keys.
 */
export function nativeChanges(before: ServiceRecord | undefined, after: ServiceRecord): NativeChange[] {
  const out: NativeChange[] = [];
  const changed = (field: keyof ServiceRecord): boolean => before === undefined || !same(before[field], after[field]);
  const leaf = (path: string[], value: NativeValue | undefined): void => { out.push([path, value === undefined ? REMOVE : value]); };

  if (changed('command') || changed('env')) leaf(['command'], nativeCommand(after.name, after.command, after.env));
  if (changed('cwd')) leaf(['working_dir'], after.cwd);
  if (changed('restart')) {
    leaf(['availability', 'restart'], after.restart?.policy);
    leaf(['availability', 'backoff_seconds'], after.restart?.backoff_seconds);
    leaf(['availability', 'max_restarts'], after.restart?.max_restarts);
  }
  if (changed('depends_on')) {
    if (after.depends_on === undefined) leaf(['depends_on'], undefined);
    else {
      const keep = new Set(after.depends_on.map((one) => one.name));
      for (const gone of before?.depends_on ?? []) if (!keep.has(gone.name)) leaf(['depends_on', gone.name], undefined);
      for (const one of after.depends_on) leaf(['depends_on', one.name, 'condition'], one.condition);
    }
  }
  if (changed('health')) {
    const health = after.health;
    if (health === undefined) leaf(['readiness_probe'], undefined);
    else if ('exec' in health) {
      leaf(['readiness_probe', 'http_get'], undefined);
      leaf(['readiness_probe', 'exec', 'command'], health.exec);
    }
    else {
      leaf(['readiness_probe', 'exec'], undefined);
      leaf(['readiness_probe', 'http_get', 'host'], health.http.host);
      leaf(['readiness_probe', 'http_get', 'port'], health.http.port);
      leaf(['readiness_probe', 'http_get', 'path'], health.http.path);
      leaf(['readiness_probe', 'http_get', 'scheme'], health.http.scheme);
    }
  }
  if (changed('schedule')) {
    const schedule = after.schedule;
    if (schedule === undefined) leaf(['schedule'], undefined);
    else {
      leaf(['schedule', 'cron'], schedule.cron);
      leaf(['schedule', 'interval'], schedule.interval);
      leaf(['schedule', 'timezone'], schedule.timezone);
      leaf(['schedule', 'run_on_start'], schedule.run_on_start);
    }
  }
  return out;
}
