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
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { constants, hostname } from 'node:os';
import { scopeOf } from '@ahpd/sdk';
import { vaultPath } from '../config.js';
import { fileVault } from '../vault.js';
import { residentIdentity } from '../service-identity.js';

/** The words this takes after `secrets exec`, read. */
export interface ExecLine {
  readonly service: string;
  /** Each variable and the reference its value comes from, in the order given. */
  readonly env: ReadonlyArray<readonly [string, string]>;
  /**
   * Each variable and the value it is set to, in the order given (#38276): only a name the record's plain allowlist
   * admits reaches here, so a value that is not a secret never has to pretend to be one.
   */
  readonly set?: ReadonlyArray<readonly [string, string]>;
  /**
   * The child's own identity, when the entry names one (#39156 B): the name the published service declaration
   * lists as this service's child. The wrapper mints that child a token at every start, so the child acts as
   * itself and never as the parent's service row.
   */
  readonly child?: string;
  /** The program, one shell word, run with `/bin/sh -c`. */
  readonly command: string;
}

/** A child's identity, as it is minted for one start: who the child is, and the 0600 file it presents. */
export interface ChildIdentity {
  readonly actor: string;
  readonly kind: 'service' | 'seat';
  /** The 0600 token file the child reads as `HAB_ID_TOKEN_FILE`; removed when the child ends. */
  readonly tokenFile: string;
}

/**
 * Mints one child's identity. The signer is hab's, never ahpd's (@cto 30f1871e): a second trust root would let any
 * driver name any actor. hab signs an actor and kind only when the published declaration lists it as that service's
 * child, and a request for any other name is refused by name.
 */
export type MintChild = (request: { readonly service: string; readonly child: string }) => Promise<ChildIdentity | { readonly refused: string }>;

/** How a run ended: the child's exit code, or the signal that ended it. */
export type ExecEnd = { readonly code: number } | { readonly signal: NodeJS.Signals };

/** Exit codes when nothing was started: the line is wrong, or the vault cannot give a value (sysexits). */
export const EXIT_USAGE = 64;
/** Nothing was started because the child's identity could not be minted (sysexits EX_UNAVAILABLE). */
export const EXIT_NO_IDENTITY = 69;
export const EXIT_NO_VALUE = 78;
/** The shell could not be started at all, as a shell answers a command it cannot find. */
export const EXIT_NO_SHELL = 127;

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CHILD_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const USAGE = "secrets exec <service> [--env NAME=<scope>:<name>]... [--set NAME=<value>]... [--child <name>] -- '<command>'";

/** The variables that carry an identity. A child gets none of the parent's, only the one minted for itself. */
const IDENTITY_ENV = ['HAB_ID_TOKEN', 'HAB_ID_TOKEN_FILE', 'AHPD_SERVICE_TOKEN_FILE'] as const;

/**
 * Fills the names a start was given at startup into an environment that no longer carries them
 * (`service-identity.ts` scrubs `process.env` on import). A name the environment already has wins.
 */
export const withResidentIdentity = (environment: NodeJS.ProcessEnv, captured: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv => {
  for (const [name, value] of Object.entries(captured)) {
    if (value !== undefined && environment[name] === undefined) environment[name] = value;
  }
  return environment;
};

/** The line read, or the sentence saying what is wrong with it. Never quotes a value: the line holds none. */
export function readExecLine(words: readonly string[]): ExecLine | string {
  const [service, ...rest] = words;
  if (service === undefined || service === '' || service.startsWith('-')) return `the first word must be the service's name; the line is ${USAGE}`;
  const env: Array<readonly [string, string]> = [];
  const set: Array<readonly [string, string]> = [];
  let child: string | undefined;
  let at = 0;
  while (at < rest.length && rest[at] !== '--') {
    const word = rest[at]!;
    const childName = word === '--child' ? rest[at + 1] : word.startsWith('--child=') ? word.slice('--child='.length) : undefined;
    if (childName !== undefined) {
      at += word === '--child' ? 2 : 1;
      if (child !== undefined) return `${service}: --child names a child twice`;
      if (!CHILD_NAME.test(childName)) return `${service}: --child ${childName} is not a child name`;
      child = childName;
      continue;
    }
    const assigned = word === '--set' ? rest[at + 1] : word.startsWith('--set=') ? word.slice('--set='.length) : undefined;
    if (assigned !== undefined) {
      at += word === '--set' ? 2 : 1;
      const equals = assigned.indexOf('=');
      const key = equals === -1 ? assigned : assigned.slice(0, equals);
      const value = equals === -1 ? '' : assigned.slice(equals + 1);
      if (!VARIABLE.test(key)) return `${service}: --set ${assigned} does not start with a variable name`;
      if ((IDENTITY_ENV as readonly string[]).includes(key)) return `${service}: --set ${key} is an identity, and an identity is never set plainly; it is minted for the child or not at all`;
      if (value === '') return `${service}: --set ${key} needs a value`;
      if (/[\s'"]/u.test(value)) return `${service}: --set ${key} holds a space or a quote, which this line cannot carry`;
      if (set.some(([held]) => held === key) || env.some(([held]) => held === key)) return `${service}: --set names ${key} twice`;
      set.push([key, value]);
      continue;
    }
    const pair = word === '--env' ? rest[at + 1] : word.startsWith('--env=') ? word.slice('--env='.length) : undefined;
    if (pair === undefined) return `${service}: "${word}" is not --env NAME=<scope>:<name>, --set NAME=<value>, --child <name> or --; the line is ${USAGE}`;
    at += word === '--env' ? 2 : 1;
    const equals = pair.indexOf('=');
    const key = equals === -1 ? pair : pair.slice(0, equals);
    const ref = equals === -1 ? '' : pair.slice(equals + 1);
    if (!VARIABLE.test(key)) return `${service}: --env ${pair} does not start with a variable name`;
    if (env.some(([held]) => held === key) || set.some(([held]) => held === key)) return `${service}: --env names ${key} twice`;
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
  return { service, env, ...(set.length === 0 ? {} : { set }), ...(child === undefined ? {} : { child }), command: after[0]! };
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
  /** The child-identity mint; hab's signer by default. A test names its own. */
  readonly mintChild?: MintChild;
}

const FORWARDED: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2'];

/** What the hab signer is reached through (#39156 B); a test names its own. */
export interface HabMintOptions {
  /** The wrapper's own environment: hab's CLI path and its habitat (and its own identity, which hab reads). */
  readonly environment?: NodeJS.ProcessEnv;
  /** The spawn used to ask hab, so a test sees the exact argv and answers for it. */
  readonly spawn?: typeof nodeSpawn;
  /** How long hab is given to answer; a signer that hangs starts nothing rather than holds the start open. */
  readonly timeoutMs?: number;
  /** The token file's permission bits, so a test can answer without a file; `statSync` by default. */
  readonly modeOf?: (path: string) => number | undefined;
}

const KINDS: readonly string[] = ['service', 'seat'];

/** One line of hab's answer, as JSON, or the reason it is not one. */
function readHabAnswer(text: string, where: string): ChildIdentity | { readonly refused: string } {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) return { refused: `${where}: expected one JSON line telling the child's identity, got ${lines.length}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!);
  }
  catch (error) {
    return { refused: `${where}: its answer is not JSON: ${(error as Error).message}` };
  }
  const answer = parsed as { actor?: unknown; kind?: unknown; tokenFile?: unknown };
  if (typeof answer?.actor !== 'string' || answer.actor === '') return { refused: `${where}: its answer names no actor` };
  if (typeof answer.kind !== 'string' || !KINDS.includes(answer.kind)) return { refused: `${where}: its answer's kind "${String(answer.kind)}" is not one of ${KINDS.join(', ')}` };
  if (typeof answer.tokenFile !== 'string' || !isAbsolute(answer.tokenFile)) return { refused: `${where}: its answer's tokenFile is not an absolute path` };
  return { actor: answer.actor, kind: answer.kind as ChildIdentity['kind'], tokenFile: answer.tokenFile };
}

/**
 * hab's signer, as the wrapper asks it (#39156 B): `hab --hab-dir <abs> mint-child-token <child>`.
 *
 * The parent is not named here and cannot be: hab selects it from the wrapper's own identity and proves that
 * identity against the canonical parent record, so a caller can neither invent a parent nor pick a child's name as
 * one. The wrapper only has to name the habitat and the child. A name it cannot find is a refusal by name — it never
 * falls back to the parent's own token — and the token file's 0600 bits are checked here again so a signer that
 * answered with a loose file starts nothing.
 */
export function habMintChild(options: HabMintOptions = {}): MintChild {
  const environment = options.environment ?? process.env;
  const spawn = options.spawn ?? nodeSpawn;
  const timeoutMs = options.timeoutMs ?? 5000;
  const modeOf = options.modeOf ?? ((path: string) => {
    try {
      return statSync(path).mode & 0o777;
    }
    catch {
      return undefined;
    }
  });
  return async ({ service, child }) => {
    const hab = environment['HAB_CLI_BIN'];
    const habitat = environment['HAB_SESSION_HABITAT_ROOT'];
    const missing = [
      hab === undefined || hab === '' ? 'HAB_CLI_BIN' : undefined,
      habitat === undefined || habitat === '' ? 'HAB_SESSION_HABITAT_ROOT' : undefined,
    ].filter((one): one is string => one !== undefined);
    if (missing.length > 0) {
      return { refused: `${service}: child ${child} cannot be given an identity: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set, so there is no hab signer to ask for it, and a child never runs as its parent's token` };
    }
    if (!isAbsolute(habitat!)) return { refused: `${service}: child ${child} cannot be given an identity: HAB_SESSION_HABITAT_ROOT is not an absolute path` };
    if (child.startsWith('-')) return { refused: `${service}: child ${child} cannot be given an identity: that is not a child name` };

    const answer = await new Promise<{ code: number | null; stdout: string; stderr: string } | { failed: string }>((done) => {
      let child_: ReturnType<typeof nodeSpawn>;
      try {
        child_ = spawn(hab!, ['--hab-dir', habitat!, 'mint-child-token', child], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment } });
      }
      catch (error) {
        done({ failed: (error as Error).message });
        return;
      }
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { child_.kill('SIGKILL'); }, timeoutMs);
      child_.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk); });
      child_.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk); });
      child_.on('error', (error) => { clearTimeout(timer); done({ failed: error.message }); });
      child_.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    });
    const where = `${service}: child ${child} was not given an identity`;
    if ('failed' in answer) return { refused: `${where}: hab could not be run: ${answer.failed}` };
    if (answer.code !== 0) {
      const said = answer.stderr.trim().split('\n').filter((line) => line !== '').slice(-1)[0];
      return { refused: `${where}: hab answered ${answer.code}${said === undefined ? '' : `: ${said}`}` };
    }
    const identity = readHabAnswer(answer.stdout, where);
    if ('refused' in identity) return identity;
    const mode = modeOf(identity.tokenFile);
    if (mode === undefined) return { refused: `${where}: hab's token file ${identity.tokenFile} cannot be read` };
    if (mode !== 0o600) return { refused: `${where}: hab's token file ${identity.tokenFile} is mode 0${mode.toString(8)}, not 0600` };
    return identity;
  };
}

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
  // The wrapper's own environment, kept as it arrived: hab's parent selector verifies the caller's resident
  // `HAB_ID_TOKEN`/`HAB_ID_TOKEN_FILE`, so the mint must see them even when the child may not. `service-identity.ts`
  // takes the identity out of `process.env` at startup (it is main.ts's first import), so in the real wrapper the
  // captured copy is put back here; a caller that supplies an environment (a test) keeps exactly what it supplied.
  const resident: NodeJS.ProcessEnv = withResidentIdentity(
    { ...(options.environment ?? process.env) },
    options.environment === undefined ? residentIdentity() : {},
  );
  const environment: NodeJS.ProcessEnv = { ...resident };
  let minted: ChildIdentity | undefined;
  if (line.child !== undefined) {
    // A named child is never handed the parent's identity: the variables that carry one are dropped from what it
    // inherits, and it gets exactly the token minted for itself. With no mint wired it starts nothing at all.
    // With no `--child` the inherited environment is left alone: until hab mints children (@dev/22's half), a service's
    // own start still presents the token process-compose handed its wrapper, and scrubbing it here would refuse it.
    for (const key of IDENTITY_ENV) delete environment[key];
    const mint = options.mintChild ?? habMintChild({ environment: resident });
    let identity: ChildIdentity | { readonly refused: string };
    try {
      identity = await mint({ service: line.service, child: line.child });
    }
    catch (error) {
      say(`ahpd secrets exec ${line.service}: the mint for child ${line.child} failed: ${(error as Error).message}; nothing was started\n`);
      return { code: EXIT_NO_IDENTITY };
    }
    if ('refused' in identity) {
      say(`ahpd secrets exec: ${identity.refused}; nothing was started\n`);
      return { code: EXIT_NO_IDENTITY };
    }
    minted = identity;
    environment.HAB_ID_TOKEN_FILE = identity.tokenFile;
  }
  const spawn = options.spawn ?? nodeSpawn;
  const assigned = Object.fromEntries(line.set ?? []);
  return await new Promise<ExecEnd>((resolve) => {
    const child = spawn('/bin/sh', ['-c', line.command], {
      stdio: 'inherit',
      env: { ...environment, ...assigned, ...values },
    });
    // The token belongs to this start: it is removed when the child ends, so a dead child leaves no identity behind
    // and the next start mints a new one.
    const discard = (): void => {
      if (minted === undefined) return;
      try { unlinkSync(minted.tokenFile); } catch { /* already gone, or the child removed it */ }
    };
    const pass = (signal: NodeJS.Signals): void => { child.kill(signal); };
    const signals = options.forward ?? FORWARDED;
    for (const signal of signals) process.on(signal, pass);
    const done = (end: ExecEnd): void => {
      for (const signal of signals) process.off(signal, pass);
      discard();
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
