/**
 * The driver for a person at the machine (#38277, @cto 876bcedd).
 *
 * A daemon method cannot see the transport a call came in on, so every method
 * caller is remote and `allowRemoteCommands` applies to it. A person at the
 * machine was ruled trusted (@cto 5d3277bd): `hightea service add`, run on the
 * machine, may add a raw command whatever the switch says. That command calls
 * these functions in-process - it can read the files anyway - as
 * `{ remote: false, principal: "local:<os user>" }`, and never goes through the
 * daemon's methods. The change log names that user.
 *
 * The machine is the one the services plugin is configured with: its options
 * are read from the daemon's own `config.json`, so the person's command and the
 * daemon's methods always act on the same files, socket and log. A write here
 * is recorded for drift exactly as a method's write is.
 *
 * It skips the switch only because its caller already has the file access a
 * person at the machine has. So no daemon method, plugin hook or pipe path may
 * call it (@cto ed929bd7): the plugin never imports this file, and a test checks.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import {
  acknowledgeFiles, changesAt, controlService, listServices, putService, removeService, serviceLogs,
  type AcknowledgeParams, type Answer, type ChangesRange, type Caller, type Listing, type Machine, type PutParams,
} from './compose.js';
import { acknowledge } from './drift.js';
import { machineOf } from './plugin.js';

/** How a services plugin entry in `config.json` is recognised: its source names the package. */
const SOURCE = /(^|[\\/])(@hallohuman[\\/]hightea-services|@ahpd[\\/]services|packages[\\/]services)([\\/]|$)/u;

/** The driver bound to this machine, as the local user. */
export interface LocalServices {
  readonly machine: Machine;
  readonly caller: Caller;
  list(): Answer<Listing>;
  put(params: PutParams): ReturnType<typeof putService>;
  remove(params: { readonly name: string; readonly ifVersion: string; readonly seen?: string }): ReturnType<typeof removeService>;
  control(name: string, verb: 'start' | 'stop' | 'restart'): ReturnType<typeof controlService>;
  logs(params: { readonly name: string; readonly endOffset?: number; readonly limit?: number }): ReturnType<typeof serviceLogs>;
  acknowledge(params: AcknowledgeParams): ReturnType<typeof acknowledgeFiles>;
  changes(range?: ChangesRange, log?: string): ReturnType<typeof changesAt>;
}

/**
 * The driver for the machine whose daemon keeps its configuration in
 * `configDir`, or the sentence saying why there is none: no readable
 * `config.json`, no services plugin entry in it, more than one, or options the
 * plugin itself would refuse.
 */
export function localServices(configDir: string, user: string = userInfo().username): LocalServices | string {
  const file = join(configDir, 'config.json');
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(file, 'utf8'));
  }
  catch (error) {
    return `cannot read ${file}: ${(error as Error).message}`;
  }
  const plugins = (held as { plugins?: unknown } | null)?.plugins;
  const entries = (Array.isArray(plugins) ? plugins : []).filter((entry): entry is { source: string; options?: unknown } =>
    entry !== null && typeof entry === 'object' && typeof (entry as { source?: unknown }).source === 'string'
    && SOURCE.test((entry as { source: string }).source));
  if (entries.length === 0) return `${file} has no services plugin entry (@hallohuman/hightea-services), so this machine's services are not configured`;
  if (entries.length > 1) return `${file} has ${entries.length} services plugin entries; keep one`;
  const options = entries[0]!.options;
  const read = machineOf(configDir, options !== null && typeof options === 'object' ? options as Record<string, unknown> : {});
  if (typeof read === 'string') return read;
  const { machine, stateFile } = read;
  try {
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(machine.changeLog), { recursive: true, mode: 0o700 });
  }
  catch (error) {
    return `cannot make the services directory for ${machine.changeLog}: ${(error as Error).message}`;
  }
  const caller: Caller = { principal: `local:${user}`, remote: false };
  const wrote = <T extends Answer<{ ifVersion: string; file: string }>>(answer: T): T => {
    if (answer.ok && (!('changed' in answer) || answer.changed === true)) acknowledge(stateFile, answer.file, answer.ifVersion);
    return answer;
  };
  return {
    machine,
    caller,
    list: () => listServices(machine),
    put: async (params) => wrote(await putService(machine, caller, params)),
    remove: async (params) => wrote(await removeService(machine, caller, params)),
    control: (name, verb) => controlService(machine, caller, { name, verb }),
    logs: (params) => serviceLogs(machine, caller, params),
    acknowledge: (params) => acknowledgeFiles(machine, caller, params, (file, hash) => acknowledge(stateFile, file, hash)),
    changes: (range = {}, log) => changesAt(machine, range, log),
  };
}
