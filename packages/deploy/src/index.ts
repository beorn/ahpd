/**
 * The deploy layer (#38276): one call places service S on machine M at version X.
 *
 * Every rule here is @cto's d9b6519a ruling, in its own words where it has them:
 *
 * - the version resolves once to a commit sha, and the fetch checks the commit is reachable from the service's
 *   declared repo and ref; the log records the sha;
 * - steps are fetch (a git worktree from one object store per repo), build, before_switch, switch (one atomic
 *   rename of a `current` symlink), check, log; the log writes `started <from>-><to>` before any step;
 * - a failed check switches back only when the service declares `migrations: expand-only` AND has a check, and the
 *   report then says the migration stays applied; otherwise the new folder stays live and the failure is loud;
 * - no check means `switched, unchecked`, never `healthy`;
 * - a second deploy of the same service on the same machine is refused by name with the running deploy's id, and
 *   there is no queue;
 * - an unfinished deploy found at start is reported as `outcome unknown: <step>`, never resumed or retried.
 *
 * ahpd itself is not deployed by this driver (@cto ca6ae480).
 */
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

/** A value that is only ever a reference: the deploy never carries a secret, the machine's vault does. */
export interface DeploySecret {
  readonly $secret: string;
}

/** A command the deploy runs, as the declaration gives it. Secrets reach it only as references. */
export interface DeployCommand {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Variables for this step. A value is `{ $secret: "<scope>:<name>" }`; a plain value is refused, not passed. */
  readonly env?: Readonly<Record<string, DeploySecret>>;
  /** How long the step may run before its process group is killed; the step's default when absent. */
  readonly timeoutMs?: number;
}

/** How long each checked step may run when the declaration names no timeout (@cto 2026-11-25). */
export const STEP_TIMEOUT_MS = { build: 30 * 60_000, before_switch: 10 * 60_000, check: 5 * 60_000 } as const;

/** The variables a step inherits besides the ones its declaration names. Nothing else from ahpd's environment. */
const MINIMAL_ENV = ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const;

/** Reads a `$secret` reference from the machine's vault; `undefined` when it has no value. */
export type SecretReader = (ref: string) => undefined | string | Promise<undefined | string>;

/** Sysexits' EX_NOINPUT, which `ahpd secrets exec` also answers a missing value with. */
export const EXIT_NO_VALUE = 78;

/** One service's deploy declaration. Absent steps are absent on purpose; a missing check is reported, not assumed. */
export interface DeployDeclaration {
  /** The repository the version must be reachable from. A local path or a URL git can fetch. */
  readonly repo: string;
  /** The declared ref, e.g. `main`. Reachability is checked against this ref, not main by accident. */
  readonly ref: string;
  /** `expand-only` is the only value, and the only value that permits an automatic switch-back. */
  readonly migrations?: 'expand-only';
  readonly build?: DeployCommand;
  /** Runs on the new release while `current` still points at the old one. */
  readonly beforeSwitch?: DeployCommand;
  /** Runs after the switch. Its absence is what makes a deploy `switched, unchecked`. */
  readonly check?: DeployCommand;
  /** How many release folders to keep, current included. Defaults to the measured default below. */
  readonly keep?: number;
}

/**
 * Releases kept by default, from the measured disk on /hh/dev (#38276 row 6): 52 G total, of which 40 G is the git
 * object store one worktree per release shares, 2.6 G node_modules and 6.7 G working tree, so a kept release costs
 * about 9 G. Three releases are about 28 G against 414 G free; five would be 46 G for no deploy benefit.
 */
export const DEFAULT_KEEP = 3;

export interface DeployStepResult {
  readonly step: DeployStep;
  readonly ok: boolean;
  readonly ms: number;
  readonly code?: number | null;
  /** The step's own last words, kept for the journal's reader. Never handed to a remote caller: a build may print a secret. */
  readonly output?: string;
  /** True when the step was killed at its timeout, so the report says "timed out after N" rather than an exit code. */
  readonly timedOut?: boolean;
}

export type DeployStep = 'resolve' | 'fetch' | 'build' | 'before_switch' | 'switch' | 'check';

export type DeployState =
  | { readonly state: 'switched, checked'; readonly sha: string; readonly from: string | null }
  | { readonly state: 'switched, unchecked'; readonly sha: string; readonly from: string | null }
  | {
      readonly state: 'switched back, migration stays applied';
      readonly sha: string;
      readonly from: string | null;
      readonly reason: string;
    }
  | {
      readonly state: 'failed, new release live';
      readonly sha: string;
      readonly from: string | null;
      readonly step: DeployStep;
      readonly reason: string;
    }
  | {
      readonly state: 'outcome unknown';
      readonly sha: string | null;
      readonly step: DeployStep;
      readonly deployId: string;
    }
  | {
      readonly state: 'refused, command not allowed';
      readonly step: DeployStep;
      readonly reason: string;
    }
  | { readonly state: 'refused, deploy running'; readonly deployId: string }
  | { readonly state: 'refused, invalid declaration'; readonly reason: string };

export interface DeployResult {
  readonly service: string;
  /** The id this deploy was given: what the journal, the refusal and the future AHP method all name it by. */
  readonly deployId: string;
  readonly sha: string;
  readonly from: string | null;
  readonly steps: readonly DeployStepResult[];
  readonly outcome: DeployState;
}

export interface DeployLayout {
  /** The host state directory; every path below is derived from it and the service name. */
  readonly stateDir: string;
  readonly service: string;
}

const paths = ({ stateDir, service }: DeployLayout) => {
  const root = join(stateDir, 'deploy', service);
  return {
    root,
    objects: join(root, 'objects'),
    releases: join(root, 'releases'),
    current: join(root, 'current'),
    journal: join(root, 'deploy.log'),
    lock: join(root, 'deploy.lock'),
  };
};

/** One line, append-only, newest last. A reader of the log never needs the process that wrote it. */
const journal = (layout: DeployLayout, event: Readonly<Record<string, unknown>>): void => {
  mkdirSync(paths(layout).root, { recursive: true });
  appendFileSync(paths(layout).journal, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
};

export interface DeployLock {
  readonly deployId: string;
  readonly step: DeployStep;
  readonly pid: number;
  /** The pid's own start time (Linux), so a reused pid cannot pass for the deploy that held the lock. */
  readonly pidStart?: string;
  readonly startedAt: string;
  readonly from: string | null;
  readonly to: string;
}

const readLock = (layout: DeployLayout): DeployLock | undefined => {
  const file = paths(layout).lock;
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DeployLock;
  } catch {
    // A lock we cannot read is still a lock: the deploy that wrote it may be mid-step.
    return { deployId: 'unreadable', step: 'resolve', pid: -1, startedAt: '', from: null, to: '' };
  }
};

/**
 * Take the deploy lock, or say who holds it. `wx` is the whole mutual exclusion: two calls, one wins the create.
 */
const takeLock = (layout: DeployLayout, body: DeployLock): boolean => {
  mkdirSync(paths(layout).root, { recursive: true });
  try {
    const descriptor = openSync(paths(layout).lock, 'wx');
    try {
      writeSync(descriptor, `${JSON.stringify(body)}\n`);
    } finally {
      closeSync(descriptor);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
};

/** Move the lock's step forward before the step runs, so a crash names the step it was in. */
const setLockStep = (layout: DeployLayout, body: DeployLock, step: DeployStep): DeployLock => {
  const next = { ...body, step };
  writeFileSync(paths(layout).lock, `${JSON.stringify(next)}\n`);
  return next;
};

const releaseLock = (layout: DeployLayout): void => {
  rmSync(paths(layout).lock, { force: true });
};

const git = (args: readonly string[], cwd?: string) =>
  spawnSync('git', [...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

/** One object store per repo, shared by every release worktree of that repo. */
const objectStore = (layout: DeployLayout, repo: string): string => {
  const key = createHash('sha256').update(repo).digest('hex').slice(0, 16);
  return join(paths(layout).objects, `${basename(repo).replace(/\.git$/u, '')}-${key}.git`);
};

const ensureObjectStore = (layout: DeployLayout, repo: string): string => {
  const store = objectStore(layout, repo);
  if (existsSync(store)) return store;
  mkdirSync(paths(layout).objects, { recursive: true });
  const made = spawnSync('git', ['init', '--bare', store], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`deploy: git init --bare ${store} failed: ${made.stderr}`);
  const remote = spawnSync('git', ['-C', store, 'remote', 'add', 'origin', repo], { encoding: 'utf8' });
  if (remote.status !== 0) throw new Error(`deploy: git remote add failed in ${store}: ${remote.stderr}`);
  return store;
};

/**
 * Resolve X once to a sha and prove the commit is reachable from the declared repo and ref. `version` may be a ref
 * (`main`), a tag, or a sha prefix; whatever it is, what comes back is one full sha or a refusal by name.
 */
export const resolveVersion = (
  layout: DeployLayout,
  declaration: Pick<DeployDeclaration, 'repo' | 'ref'>,
  version: string,
): string => {
  const store = ensureObjectStore(layout, declaration.repo);
  const fetched = git(['-C', store, 'fetch', '--quiet', '--prune', 'origin', `+refs/heads/*:refs/remotes/origin/*`, '+refs/tags/*:refs/tags/*']);
  if (fetched.status !== 0) throw new Error(`deploy: fetch of ${declaration.repo} failed: ${fetched.stderr.trim()}`);
  const remoteRef = `refs/remotes/origin/${declaration.ref}`;
  const refCheck = git(['-C', store, 'rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]);
  if (refCheck.status !== 0) {
    throw new Error(`deploy: ${declaration.repo} has no ref ${declaration.ref} (looked for ${remoteRef})`);
  }
  // The store tracks the declared repo's branches only as refs/remotes/origin/*, so a version that names a branch
  // or a tag has to be looked for there too.
  const existing = (ref: string): boolean => git(['-C', store, 'rev-parse', '--verify', '--quiet', ref]).status === 0;
  let resolved = git(['-C', store, 'rev-parse', '--verify', '--quiet', `${version}^{commit}`]);
  if (resolved.status !== 0) {
    for (const candidate of [`refs/remotes/origin/${version}`, `refs/tags/${version}`]) {
      const attempt = git(['-C', store, 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
      if (attempt.status !== 0) continue;
      resolved = attempt;
      break;
    }
  }
  if (resolved.status !== 0) throw new Error(`deploy: ${version} is not a commit in ${declaration.repo}`);
  const sha = resolved.stdout.trim();
  // Naming a published branch or tag is a deliberate choice and deploys it. A raw object id has to be on the
  // declared ref's lineage, so a commit from an unrelated branch is refused by name instead of shipped by accident.
  const byName = existing(`refs/remotes/origin/${version}`) || existing(`refs/tags/${version}`);
  if (!byName) {
    const reachable = git(['-C', store, 'merge-base', '--is-ancestor', sha, remoteRef]);
    if (reachable.status !== 0) {
      throw new Error(`deploy: ${version} (${sha}) is not reachable from ${declaration.ref} in ${declaration.repo}`);
    }
  }
  return sha;
};

/** What `current` points at today, as the release folder's name, or null when nothing is deployed yet. */
export const currentRelease = (layout: DeployLayout): string | null => {
  const link = paths(layout).current;
  if (!existsSync(link)) return null;
  try {
    return basename(readlinkSync(link));
  } catch {
    return null;
  }
};

/**
 * Runs one step in its own process group, with a minimal environment and a timeout (@cto 2026-11-25).
 *
 * Three rules, each a hole that was open: a build inherited every token ahpd holds, so the environment is PATH, HOME,
 * LANG and TMPDIR plus the step's own `$secret` references, read from the vault; a build with no timeout can hold the
 * lock forever, so each step has one and its expiry kills the whole group rather than the one process; and a missing
 * secret starts nothing, answering 78 with the reference named - the same answer `ahpd secrets exec` gives.
 */
const runStep = async (
  step: DeployStep, command: DeployCommand | undefined, cwd: string, secrets: SecretReader | undefined, machine: string,
): Promise<DeployStepResult> => {
  if (command === undefined) return { step, ok: true, ms: 0 };
  const started = Date.now();
  const env: Record<string, string> = {};
  for (const key of MINIMAL_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(command.env ?? {})) {
    const read = secrets === undefined ? undefined : await secrets(value.$secret);
    if (read === undefined) {
      // Starting the command without the variable would be a program that half works; nothing runs instead.
      return { step, ok: false, ms: Date.now() - started, code: EXIT_NO_VALUE, output: `secret ${value.$secret} has no value on ${machine}; nothing was started` };
    }
    env[key] = read;
  }
  const timeout = command.timeoutMs ?? (step === 'build' || step === 'before_switch' || step === 'check' ? STEP_TIMEOUT_MS[step] : undefined);
  return await new Promise<DeployStepResult>((resolve) => {
    let output = '';
    const collect = (chunk: Buffer): void => { output = `${output}${chunk.toString('utf8')}`.slice(-4000); };
    const child = spawn(command.command, [...(command.args ?? [])], {
      cwd: command.cwd === undefined ? cwd : join(cwd, command.cwd),
      env,
      // Its own group, so expiry can kill what the step started as well as the step.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let timedOut = false;
    const timer = timeout === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group is already gone; `close` still fires and says how it ended.
      }
    }, timeout);
    child.on('error', (error) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ step, ok: false, ms: Date.now() - started, code: null, output: `${output}${error.message}`.trim() });
    });
    child.on('close', (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      const ms = Date.now() - started;
      const text = timedOut ? `${output}timed out after ${String(timeout)} ms`.trim() : output.trim();
      resolve({ step, ok: code === 0 && signal === null && !timedOut, ms, code, output: text, ...(timedOut ? { timedOut: true } : {}) });
    });
  });
};

/** Exactly one atomic rename: the temporary link is built beside `current` and renamed over it. Internal: a switch
 * that is not in the journal is a silent gap, so callers go through `activateRelease`. */
const switchCurrent = (layout: DeployLayout, sha: string): void => {
  const link = paths(layout).current;
  const temporary = `${link}.${randomUUID()}.new`;
  symlinkSync(join('releases', sha), temporary, 'dir');
  renameSync(temporary, link);
};

/**
 * Switch `current` to a release and journal it, as one call (@cto 2026-11-25, #38280).
 *
 * The journal is how versions and switch-back know what happened, so the switch and its line leave together: a deploy
 * and a customer host install both come through here, and neither can move `current` without saying so.
 */
export const activateRelease = (
  layout: DeployLayout,
  version: string,
  reason: string,
  detail: Readonly<Record<string, unknown>> = {},
): void => {
  // Read before the rename: the line records what the switch left, which is the release a rollback returns to.
  const from = currentRelease(layout);
  switchCurrent(layout, version);
  journal(layout, { ...detail, event: 'switched', to: version, from, reason });
};

/**
 * A line that undid a switch, so the release it left is not a way back: the forward switch that followed it is.
 *
 * The `back` flag is the contract (@cto 2026-11-25): a reason is prose, and a prune that reads prose silently changes
 * what it keeps the moment somebody rewords it. The text match stays only for lines written before the flag existed.
 */
const isSwitchBack = (entry: Readonly<Record<string, unknown>>): boolean =>
  entry['back'] === true || (typeof entry['reason'] === 'string' && entry['reason'].startsWith('switching back'));

/**
 * The release the last forward switch left, which is the one a rollback returns to; null when nothing switched yet.
 *
 * Switch-back lines are skipped on purpose (@cto 2026-11-25): after a failed upgrade the newest `switched` row leaves
 * the *bad* release, and treating that as the way back would prune the good one and keep the one that failed.
 */
export const lastSwitchFrom = (layout: DeployLayout): string | null => {
  const entries = readJournal(layout);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined || entry['event'] !== 'switched' || isSwitchBack(entry)) continue;
    const from = entry['from'];
    return typeof from === 'string' && from !== '' ? from : null;
  }
  return null;
};

/**
 * Which release folders to remove: `current`, then the release the last switch left (`rollback`), then the newest
 * others, up to `keep`. Keeping the rollback target is what makes "switch back" possible after a successful switch:
 * with `keep` 2 that is the current release and exactly one way back (@cto 2026-11-25). The rule is here, once, so a
 * git deploy and a customer install prune the same way; only the ordering differs (commit time there, version order
 * for an install).
 */
export const releasesToPrune = (
  orderedNewestFirst: readonly string[],
  current: string | null,
  keep = DEFAULT_KEEP,
  rollback: string | null = null,
): readonly string[] => {
  const keeping = new Set<string>();
  if (current !== null) keeping.add(current);
  // A rollback target only exists when there is room for it: `keep` 1 is the current release alone.
  if (rollback !== null && keep >= 2 && rollback !== current && orderedNewestFirst.includes(rollback))
    keeping.add(rollback);
  for (const name of orderedNewestFirst) {
    if (keeping.size >= keep) break;
    keeping.add(name);
  }
  return orderedNewestFirst.filter((name) => !keeping.has(name));
};

/** Keep `current`, the release the last switch left, and the newest releases up to `keep`; the rest is removed by name. */
export const pruneReleases = (layout: DeployLayout, keep = DEFAULT_KEEP): readonly string[] => {
  const releases = paths(layout).releases;
  if (!existsSync(releases)) return [];
  const current = currentRelease(layout);
  const ordered = readdirSync(releases, { withFileTypes: true })
    .filter((one) => one.isDirectory())
    .map((one) => {
      const stat = git(['-C', join(releases, one.name), 'show', '-s', '--format=%ct', 'HEAD']);
      const at = Number.parseInt(stat.stdout.trim(), 10);
      return { name: one.name, at: Number.isNaN(at) ? 0 : at };
    })
    .sort((left, right) => right.at - left.at || right.name.localeCompare(left.name))
    .map((one) => one.name);
  const removed = releasesToPrune(ordered, current, keep, lastSwitchFrom(layout));
  for (const name of removed) {
    rmSync(join(releases, name), { recursive: true, force: true });
    const objects = paths(layout).objects;
    if (existsSync(objects)) {
      for (const store of readdirSync(objects)) git(['-C', join(objects, store), 'worktree', 'prune']);
    }
  }
  return removed;
};

export interface DeployOptions extends DeployLayout {
  readonly version: string;
  readonly declaration: DeployDeclaration;
  /** A deploy id the caller may choose; generated otherwise. It is what the refusal and the journal carry. */
  readonly deployId?: string;
  /** The lock a caller already took through {@link claim}, so a caller that answers before the steps does not claim twice. */
  readonly claimed?: DeployLock;
  /**
   * Whether this machine accepts a build or hook command, asked before that step runs; absent accepts every command.
   *
   * The gate is injected rather than read here on purpose: the machine's `allowRemoteCommands` setting has one
   * reader (#38277), and a second one in this package would be the copy that drifts. It answers a refusal reason,
   * never a bare false, because the journal and the report say why by name.
   */
  readonly permit?: (step: DeployStep, command: DeployCommand) => string | undefined;
  /** The machine's vault, for a command's `$secret` references; absent refuses every reference by name. */
  readonly secrets?: SecretReader;
  /** The machine's name as a missing-secret sentence says it; the host name by default. */
  readonly machine?: string;
}

/**
 * When a process started, from `/proc/<pid>/stat` field 22, or undefined where there is no /proc (macOS).
 *
 * A pid alone is not identity: a machine that has deployed a few times can hand the same number to another process
 * between two reads, and a lock would then read as live for something that never held it (@cto 2026-11-25).
 */
const pidStart = (pid: number): string | undefined => {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
    // The second field is the command in parentheses and may contain spaces, so fields count from the last ')'.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/u);
    return fields[19];
  } catch {
    return undefined;
  }
};

/**
 * Whether the deploy named by a lock still runs, which separates a live lock from a dead one's.
 *
 * The pid must be alive AND still the process that wrote the lock: where a start time was recorded, it must match.
 * Where none was (macOS, or a lock written before this check) the pid is all there is, and that is said, not guessed.
 */
const alive = (lock: Pick<DeployLock, 'pid' | 'pidStart'>): boolean => {
  if (lock.pid <= 0) return false;
  try {
    process.kill(lock.pid, 0);
  } catch {
    return false;
  }
  if (lock.pidStart === undefined) return true;
  const now = pidStart(lock.pid);
  return now === undefined ? true : now === lock.pidStart;
};

/** A claim's lock, when it took one; or the answer the whole-call path would have given instead. */
export type Claim =
  | { readonly ok: true; readonly lock: DeployLock }
  | { readonly ok: false; readonly result: DeployResult };

/**
 * Takes one service's deploy lock without running a step.
 *
 * A caller that answers before the work needs this: an AHP method's round trip is seconds while a deploy is minutes,
 * so the method claims, answers `started <deployId>`, and lets the steps run. Claiming first is what keeps that
 * answer truthful — a second call in the same second is refused by the running deploy's id, exactly as the
 * whole-call path refuses it.
 */
export const claim = (layout: DeployLayout, deployId: string = randomUUID()): Claim => {
  const before = readLock(layout);
  if (before !== undefined) {
    if (alive(before)) {
      journal(layout, { event: 'refused', deployId: before.deployId, holder: before.deployId, step: before.step });
      const outcome: DeployState = { state: 'refused, deploy running', deployId: before.deployId };
      return { ok: false, result: { service: layout.service, deployId: before.deployId, sha: before.to, from: before.from, steps: [], outcome } };
    }
    // The lock outlived its process: say which step it was in and stop. It is never resumed or retried.
    journal(layout, { event: 'outcome unknown', deployId: before.deployId, step: before.step, pid: before.pid });
    releaseLock(layout);
    const outcome: DeployState = { state: 'outcome unknown', sha: before.to === '' ? null : before.to, step: before.step, deployId: before.deployId };
    return { ok: false, result: { service: layout.service, deployId: before.deployId, sha: before.to, from: before.from, steps: [], outcome } };
  }

  const from = currentRelease(layout);
  const start = pidStart(process.pid);
  const lock: DeployLock = { deployId, step: 'resolve', pid: process.pid, ...(start === undefined ? {} : { pidStart: start }), startedAt: new Date().toISOString(), from, to: '' };
  if (!takeLock(layout, lock)) {
    const holder = readLock(layout);
    const outcome: DeployState = { state: 'refused, deploy running', deployId: holder?.deployId ?? 'unknown' };
    return { ok: false, result: { service: layout.service, deployId: outcome.deployId, sha: holder?.to ?? '', from, steps: [], outcome } };
  }
  return { ok: true, lock };
};

/**
 * One call: service S on machine M at version X. Refuses while another deploy of the same service holds the lock;
 * reports `outcome unknown: <step>` when the lock is left over from a process that is gone, and never resumes it.
 *
 * `claimed` is for a caller that already took the lock through {@link claim} so it could answer before the steps.
 */
export const deploy = async (options: DeployOptions): Promise<DeployResult> => {
  const layout: DeployLayout = { stateDir: options.stateDir, service: options.service };
  if (options.declaration.keep !== undefined && options.declaration.keep < 2) {
    // One kept release is a folder with no way back by hand (@cto 2026-11-25).
    journal(layout, { event: 'refused', deployId: options.deployId ?? 'none', reason: `keep must be at least 2, so a person can always switch back; it was ${String(options.declaration.keep)}` });
    return {
      service: options.service, deployId: options.deployId ?? '', sha: '', from: currentRelease(layout), steps: [],
      outcome: { state: 'refused, invalid declaration', reason: `keep must be at least 2, so a person can always switch back; it was ${String(options.declaration.keep)}` },
    };
  }
  let lock: DeployLock;
  if (options.claimed === undefined) {
    const taken = claim(layout, options.deployId);
    if (!taken.ok) return taken.result;
    lock = taken.lock;
  } else {
    lock = options.claimed;
  }
  const { deployId, from } = lock;
  const machine = options.machine ?? hostname();
  let sha: string;
  try {
    sha = resolveVersion(layout, options.declaration, options.version);
  } catch (error) {
    journal(layout, { event: 'failed', deployId, step: 'resolve', reason: error instanceof Error ? error.message : String(error) });
    releaseLock(layout);
    throw error;
  }
  const resolving = { ...lock, to: sha };
  writeFileSync(paths(layout).lock, `${JSON.stringify(resolving)}\n`);

  const steps: DeployStepResult[] = [];
  // What a remote reader needs: which steps ran, how long, and how each ended - never the output, which a build may
  // print a secret into (@cto 2026-11-25).
  const summary = () => steps.map(({ step, ok, ms, code, timedOut }) => ({ step, ok, ms, code, ...(timedOut === true ? { timedOut } : {}) }));
  const finish = (outcome: DeployState): DeployResult => {
    journal(layout, { event: 'finished', deployId, sha, from, outcome: outcome.state, steps: summary() });
    releaseLock(layout);
    return { service: options.service, deployId, sha, from, steps, outcome };
  };
  const fail = (step: DeployStep, reason: string): DeployState => {
    journal(layout, { event: 'failed', deployId, sha, step, reason, steps: summary() });
    return { state: 'failed, new release live', sha, from, step, reason };
  };

  /** A step's command runs only when the machine's gate accepts it; nothing is read about that here. */
  const rejected = (step: DeployStep, command: DeployCommand | undefined): string | undefined =>
    command === undefined ? undefined : options.permit?.(step, command);

  // Every gate first, before the lock says `started`: a refused check after the switch left an unchecked release
  // live, which is the hole this closes (@cto 2026-11-25). A refused step now means the deploy never began.
  for (const [step, command] of [
    ['build', options.declaration.build],
    ['before_switch', options.declaration.beforeSwitch],
    ['check', options.declaration.check],
  ] as const) {
    const why = rejected(step, command);
    if (why === undefined) continue;
    journal(layout, { event: 'refused', deployId, step, reason: why });
    releaseLock(layout);
    return { service: options.service, deployId, sha, from, steps, outcome: { state: 'refused, command not allowed', step, reason: why } };
  }

  try {
    // The ruling's first line: "started <from>-><to>" is written before any step runs.
    journal(layout, { event: 'started', deployId, from, to: sha, version: options.version });

    lock = setLockStep(layout, lock, 'fetch');
    const store = ensureObjectStore(layout, options.declaration.repo);
    const release = join(paths(layout).releases, sha);
    mkdirSync(paths(layout).releases, { recursive: true });
    if (!existsSync(release)) {
      const added = git(['-C', store, 'worktree', 'add', '--detach', release, sha]);
      if (added.status !== 0) {
        const reason = `worktree add failed: ${added.stderr.trim()}`;
        steps.push({ step: 'fetch', ok: false, ms: 0, output: reason });
        return finish(fail('fetch', reason));
      }
      // The checkout talks to the same origin the object store does; a release folder is never its own clone.
      git(['-C', release, 'remote', 'set-url', 'origin', options.declaration.repo]);
    }
    steps.push({ step: 'fetch', ok: true, ms: 0 });

    lock = setLockStep(layout, lock, 'build');
    const built = await runStep('build', options.declaration.build, release, options.secrets, machine);
    steps.push(built);
    if (!built.ok) return finish(fail('build', built.timedOut === true ? `build ${built.output ?? 'timed out'}` : `build exited ${String(built.code)}${built.code === EXIT_NO_VALUE ? `: ${built.output ?? ''}` : ''}`));

    lock = setLockStep(layout, lock, 'before_switch');
    const hooked = await runStep('before_switch', options.declaration.beforeSwitch, release, options.secrets, machine);
    steps.push(hooked);
    if (!hooked.ok) return finish(fail('before_switch', hooked.timedOut === true ? `before_switch ${hooked.output ?? 'timed out'}` : `before_switch exited ${String(hooked.code)}${hooked.code === EXIT_NO_VALUE ? `: ${hooked.output ?? ''}` : ''}`));

    lock = setLockStep(layout, lock, 'switch');
    activateRelease(layout, sha, 'deploy', { deployId, sha, from });
    steps.push({ step: 'switch', ok: true, ms: 0 });

    if (options.declaration.check === undefined) {
      // No check is not a pass: the deploy says exactly what it did and what it did not do.
      pruneReleases(layout, options.declaration.keep);
      return finish({ state: 'switched, unchecked', sha, from });
    }

    lock = setLockStep(layout, lock, 'check');
    const checked = await runStep('check', options.declaration.check, release, options.secrets, machine);
    steps.push(checked);
    if (checked.ok) {
      pruneReleases(layout, options.declaration.keep);
      return finish({ state: 'switched, checked', sha, from });
    }

    const reason = checked.timedOut === true
      ? `check ${checked.output ?? 'timed out'}`
      : `check exited ${String(checked.code)}${checked.code === EXIT_NO_VALUE ? `: ${checked.output ?? ''}` : ''}`;
    if (options.declaration.migrations === 'expand-only' && from !== null) {
      // The migration is already applied, so the folder goes back and the report says the migration stays.
      activateRelease(layout, from, 'switching back after a failed check', { deployId, sha, back: true });
      journal(layout, { event: 'switched back', deployId, sha, to: from });
      return finish({ state: 'switched back, migration stays applied', sha, from, reason });
    }
    // No declared migration: the new folder stays live and the failure is loud, never a silent rollback.
    return finish(fail('check', reason));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    journal(layout, { event: 'failed', deployId, sha, step: lock.step, reason, steps: summary() });
    releaseLock(layout);
    const outcome: DeployState = { state: 'failed, new release live', sha, from, step: lock.step, reason };
    return { service: options.service, deployId, sha, from, steps, outcome };
  }
};

// #38276 slice 2: the package is also an ahpd plugin, `x-ahpd/deploy/run` and `x-ahpd/deploy/report` (plugin.ts).
export { apply, deployMethods, METHODS, name, title, startChild, REQUEST_FILE } from './plugin.js';
export type { DeployHost, DeployMethod, DeployRefusal, DeployRefusalCode, DeployMethodsOptions, DeployRequest, HandedRequest } from './plugin.js';

/** One line added to a service's journal by a caller that has no deploy running: the method's own record. */
export const writeJournalEntry = (layout: DeployLayout, entry: Readonly<Record<string, unknown>>): void => journal(layout, entry);

/** The journal, oldest first, for a reader that shows what happened without running anything. */
export const readJournal = (layout: DeployLayout): readonly Readonly<Record<string, unknown>>[] => {
  const file = paths(layout).journal;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

/** Whether this service can be deployed at all, and what would refuse it — read-only, never mutating. */
/** A deploy left unfinished before this process started, as the start-up sweep reports it. */
export interface SweptDeploy {
  readonly service: string;
  readonly step: DeployStep;
  readonly deployId: string;
}

/**
 * What ahpd reports when it starts: every deploy whose lock outlived its process, by service, with the step it died in.
 *
 * The lock is dropped and the journal keeps the `outcome unknown` line, because the one thing this must never do is
 * resume work whose result nobody knows. A live deploy is left alone: its lock is the refusal the next one gets.
 */
export const sweep = (stateDir: string): readonly SweptDeploy[] => {
  const root = join(stateDir, 'deploy');
  if (!existsSync(root)) return [];
  const swept: SweptDeploy[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const layout: DeployLayout = { stateDir, service: entry.name };
    const lock = readLock(layout);
    if (lock === undefined || alive(lock)) continue;
    journal(layout, { event: 'outcome unknown', deployId: lock.deployId, step: lock.step, pid: lock.pid, found: 'at start' });
    releaseLock(layout);
    swept.push({ service: entry.name, step: lock.step, deployId: lock.deployId });
  }
  return swept;
};

export const status = (layout: DeployLayout): { readonly current: string | null; readonly lock: DeployLock | undefined } => {
  return { current: currentRelease(layout), lock: readLock(layout) };
};

/* A customer host install (#38280): the manifest, the plan a customer reads, and the removal list. */
export * from './install.js';

/* Doing what the plan said, and undoing it (#38280): apply, uninstall, and the refusals in front of both. */
export * from './install-run.js';
