/**
 * `ahpd secrets exec`: start one program with its secrets in its environment
 * (#38277, @cto's wrapper ruling).
 *
 * process-compose starts, restarts and schedules a machine's programs itself,
 * often while ahpd is down, so a value cannot be handed in by the daemon at
 * each start. The services driver (`@hallohuman/hightea-services`, `record.ts`
 * `nativeCommand`) writes a program that needs a secret as
 *
 *     ahpd secrets exec <service> --env KEY=<scope>:<name> ... -- '<command>'
 *
 * and this runs at every one of those starts. It reads `vault.json` straight
 * from the configuration directory, the same file `ahpd vault set` writes, so
 * it needs no running daemon. The line names references only; each value goes
 * into the child's environment and nowhere else: never its argv (which `ps`
 * shows), never a line this writes (which process-compose keeps in its log).
 *
 * A reference with no value stops the start: the child is never spawned, and
 * stderr says "secret <name> has no value on <machine>". Starting the program
 * without the variable would be a program that half works, and the refusal on
 * every start is what tells a person the vault is missing a name.
 *
 * It is read here, ahead of the program `main.ts` builds, rather than declared
 * in the registry: the line is the driver's, not a person's, and the program's
 * own output and exit handling would stand between the child and process-compose,
 * which must see the child's own exit code and signal.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants, hostname } from 'node:os';
import { scopeOf } from '@ahpd/sdk';
import { vaultPath } from '../config.js';
import { fileVault } from '../vault.js';

/** The words this takes after `secrets exec`, read. */
export interface ExecLine {
  readonly service: string;
  /** Each variable and the reference its value comes from, in the order given. */
  readonly env: ReadonlyArray<readonly [string, string]>;
  /** The program, one shell word, run with `/bin/sh -c`. */
  readonly command: string;
}

/** How a run ended: the child's exit code, or the signal that ended it. */
export type ExecEnd = { readonly code: number } | { readonly signal: NodeJS.Signals };

/** Exit codes when nothing was started: the line is wrong, or the vault cannot give a value (sysexits). */
export const EXIT_USAGE = 64;
export const EXIT_NO_VALUE = 78;
/** The shell could not be started at all, as a shell answers a command it cannot find. */
export const EXIT_NO_SHELL = 127;

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const USAGE = "secrets exec <service> [--env NAME=<scope>:<name>]... -- '<command>'";

/** The line read, or the sentence saying what is wrong with it. Never quotes a value: the line holds none. */
export function readExecLine(words: readonly string[]): ExecLine | string {
  const [service, ...rest] = words;
  if (service === undefined || service === '' || service.startsWith('-')) return `the first word must be the service's name; the line is ${USAGE}`;
  const env: Array<readonly [string, string]> = [];
  let at = 0;
  while (at < rest.length && rest[at] !== '--') {
    const word = rest[at]!;
    const pair = word === '--env' ? rest[at + 1] : word.startsWith('--env=') ? word.slice('--env='.length) : undefined;
    if (pair === undefined) return `${service}: "${word}" is not --env NAME=<scope>:<name> or --; the line is ${USAGE}`;
    at += word === '--env' ? 2 : 1;
    const equals = pair.indexOf('=');
    const key = equals === -1 ? pair : pair.slice(0, equals);
    const ref = equals === -1 ? '' : pair.slice(equals + 1);
    if (!VARIABLE.test(key)) return `${service}: --env ${pair} does not start with a variable name`;
    if (env.some(([held]) => held === key)) return `${service}: --env names ${key} twice`;
    try {
      scopeOf(ref);
    }
    catch (error) {
      return `${service}: --env ${key}: ${(error as Error).message}`;
    }
    env.push([key, ref]);
  }
  if (rest[at] !== '--') return `${service}: no -- before the command; the line is ${USAGE}`;
  const after = rest.slice(at + 1);
  if (after.length !== 1 || after[0]!.trim() === '') return `${service}: the command after -- must be one quoted word; the line is ${USAGE}`;
  return { service, env, command: after[0]! };
}

/** What a run reads from outside it, so a test can name its own. */
export interface ExecOptions {
  /** The vault file; the daemon's own `vaultPath()` unless a test names another. */
  readonly vaultFile?: string;
  /** The machine's name as the refusal says it; `os.hostname()` by default. */
  readonly machine?: string;
  /** The environment the child inherits, before its secrets are added. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Where refusals are written; process-compose keeps it in its log, so it never carries a value. */
  readonly stderr?: (text: string) => void;
  /** The spawn this uses; a test wraps the real one to see its arguments. */
  readonly spawn?: typeof nodeSpawn;
  /** The signals passed on to the child while it runs. */
  readonly forward?: readonly NodeJS.Signals[];
}

const FORWARDED: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2'];

/**
 * Read the line, fetch each value from the vault, and run the command with the
 * values in its environment until it ends.
 *
 * Nothing is spawned unless every reference has a value. A line that cannot be
 * read, a vault file that is not there or cannot be read, and a reference with
 * no value are each one line on stderr naming the thing and a code saying
 * nothing ran. While the child runs, the signals process-compose sends are
 * passed on to it, and how it ended is what this answers.
 */
export async function secretsExec(words: readonly string[], options: ExecOptions = {}): Promise<ExecEnd> {
  const say = options.stderr ?? ((text: string) => { process.stderr.write(text); });
  const machine = options.machine ?? hostname();
  const line = readExecLine(words);
  if (typeof line === 'string') {
    say(`ahpd secrets exec: ${line}; nothing was started\n`);
    return { code: EXIT_USAGE };
  }
  const values: Record<string, string> = {};
  if (line.env.length > 0) {
    const file = options.vaultFile ?? vaultPath();
    // `fileVault` reads a missing file as a vault holding nothing, which is right
    // for a daemon that has not stored a secret yet; here it would hide that the
    // vault this machine was meant to have is not where ahpd keeps it.
    if (!existsSync(file)) {
      say(`ahpd secrets exec ${line.service}: no vault at ${file} on ${machine}, so ${line.env.map(([, ref]) => ref).join(', ')} cannot be read; nothing was started\n`);
      return { code: EXIT_NO_VALUE };
    }
    const vault = fileVault({ file });
    const missing: string[] = [];
    for (const [key, ref] of line.env) {
      let value: string | undefined;
      try {
        value = await vault.get(ref);
      }
      catch (error) {
        // The vault's own sentences are fixed and never quote the file.
        say(`ahpd secrets exec ${line.service}: ${(error as Error).message}; nothing was started\n`);
        return { code: EXIT_NO_VALUE };
      }
      if (value === undefined) missing.push(ref);
      else values[key] = value;
    }
    if (missing.length > 0) {
      for (const ref of missing) say(`ahpd secrets exec ${line.service}: secret ${ref} has no value on ${machine}; nothing was started\n`);
      return { code: EXIT_NO_VALUE };
    }
  }
  const spawn = options.spawn ?? nodeSpawn;
  return await new Promise<ExecEnd>((resolve) => {
    const child = spawn('/bin/sh', ['-c', line.command], {
      stdio: 'inherit',
      env: { ...(options.environment ?? process.env), ...values },
    });
    const pass = (signal: NodeJS.Signals): void => { child.kill(signal); };
    const signals = options.forward ?? FORWARDED;
    for (const signal of signals) process.on(signal, pass);
    const done = (end: ExecEnd): void => {
      for (const signal of signals) process.off(signal, pass);
      resolve(end);
    };
    child.on('error', (error) => {
      say(`ahpd secrets exec ${line.service}: /bin/sh could not be started: ${error.message}\n`);
      done({ code: EXIT_NO_SHELL });
    });
    child.on('exit', (code, signal) => {
      done(signal !== null ? { signal } : { code: code ?? 1 });
    });
  });
}

/**
 * The run as a process: exit with the child's code, or end by the signal that
 * ended it, so process-compose reads this process's end as the program's.
 */
export async function runSecretsExec(words: readonly string[]): Promise<never> {
  const end = await secretsExec(words);
  if ('signal' in end) {
    process.kill(process.pid, end.signal);
    // Reached only if the signal did not end this process: the shell's code for it.
    process.exit(128 + (constants.signals[end.signal] ?? 0));
  }
  process.exit(end.code);
}
