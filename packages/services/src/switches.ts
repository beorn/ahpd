/**
 * The switches only the machine itself may set (#38277, #38271; @cto 8033ccb4).
 *
 * They live under one top-level key, `machine`, in the daemon's own
 * `config.json`, beside every other setting. That key is not one of the keys
 * root config serves, so no client of the protocol - Hightea included - can
 * read or write it: `RootConfigPort.write` is only ever called with keys its
 * schema names. A person changes them by editing the file on the machine.
 *
 * Both are off unless the file says otherwise. The file is read again on every
 * call, so a change takes effect on the next request without a restart.
 *
 * A file that cannot be read as these switches is refused by name rather than
 * read as "off": a misspelt switch that quietly meant off would be a setting
 * the person believes is on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the machine allows from outside it. */
export interface MachineSwitches {
  /** A command (a program's command line, a build or hook) sent from Hightea may be written and run here. */
  readonly allowRemoteCommands: boolean;
  /** A room ask from Hightea may wake an agent on this machine. */
  readonly allowRoomAsks: boolean;
}

/** The key in `config.json` that holds them. */
export const MACHINE_KEY = 'machine';

const SWITCHES = ['allowRemoteCommands', 'allowRoomAsks'] as const;

/** The refusal a raw command from outside gets while the switch is off. */
export const REMOTE_COMMANDS_OFF = 'this machine does not accept commands from Hightea; set allowRemoteCommands locally';

/** The refusal a room ask from outside gets while the switch is off. */
export const ROOM_ASKS_OFF = 'this machine does not accept room asks; set allowRoomAsks locally';

/**
 * Read the switches from `<configDir>/config.json`, where `configDir` is the
 * daemon's own (`PluginContext.configDir`).
 *
 * No file, or no `machine` key, is both off. Anything else that is not exactly
 * `{ allowRemoteCommands?: boolean, allowRoomAsks?: boolean }` throws, naming
 * the file and the key.
 */
export function machineSwitches(configDir: string): MachineSwitches {
  const file = join(configDir, 'config.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { allowRemoteCommands: false, allowRoomAsks: false };
    throw new Error(`machine switches: cannot read ${file}: ${(error as Error).message}`);
  }
  let held: unknown;
  try {
    held = JSON.parse(text);
  }
  catch (error) {
    throw new Error(`machine switches: ${file} is not JSON: ${(error as Error).message}`);
  }
  if (typeof held !== 'object' || held === null || Array.isArray(held)) {
    throw new Error(`machine switches: ${file} is not a JSON object`);
  }
  const machine = (held as Record<string, unknown>)[MACHINE_KEY];
  if (machine === undefined) return { allowRemoteCommands: false, allowRoomAsks: false };
  if (typeof machine !== 'object' || machine === null || Array.isArray(machine)) {
    throw new Error(`machine switches: "${MACHINE_KEY}" in ${file} must be an object`);
  }
  for (const [key, value] of Object.entries(machine)) {
    if (!(SWITCHES as readonly string[]).includes(key)) {
      throw new Error(`machine switches: "${MACHINE_KEY}.${key}" in ${file} is not a switch; the switches are ${SWITCHES.join(', ')}`);
    }
    if (typeof value !== 'boolean') {
      throw new Error(`machine switches: "${MACHINE_KEY}.${key}" in ${file} must be true or false`);
    }
  }
  const of = machine as Partial<Record<(typeof SWITCHES)[number], boolean>>;
  return { allowRemoteCommands: of.allowRemoteCommands === true, allowRoomAsks: of.allowRoomAsks === true };
}
