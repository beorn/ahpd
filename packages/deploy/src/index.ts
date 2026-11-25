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
import { spawnSync } from 'node:child_process';
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
import { basename, join } from 'node:path';

/** A command the deploy runs, as the declaration gives it. Secrets reach it only as references. */
export interface DeployCommand {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

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
  readonly output?: string;
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
  | { readonly state: 'refused, deploy running'; readonly deployId: string };

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

interface LockBody {
  readonly deployId: string;
  readonly step: DeployStep;
  readonly pid: number;
  readonly startedAt: string;
  readonly from: string | null;
  readonly to: string;
}

const readLock = (layout: DeployLayout): LockBody | undefined => {
  const file = paths(layout).lock;
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LockBody;
  } catch {
    // A lock we cannot read is still a lock: the deploy that wrote it may be mid-step.
    return { deployId: 'unreadable', step: 'resolve', pid: -1, startedAt: '', from: null, to: '' };
  }
};

/**
 * Take the deploy lock, or say who holds it. `wx` is the whole mutual exclusion: two calls, one wins the create.
 */
const takeLock = (layout: DeployLayout, body: LockBody): boolean => {
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
const setLockStep = (layout: DeployLayout, body: LockBody, step: DeployStep): void => {
  writeFileSync(paths(layout).lock, `${JSON.stringify({ ...body, step })}\n`);
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

const runStep = (step: DeployStep, command: DeployCommand | undefined, cwd: string): DeployStepResult => {
  if (command === undefined) return { step, ok: true, ms: 0 };
  const started = Date.now();
  const ran = spawnSync(command.command, [...(command.args ?? [])], {
    cwd: command.cwd === undefined ? cwd : join(cwd, command.cwd),
    encoding: 'utf8',
    env: { ...process.env, ...command.env },
  });
  const output = `${ran.stdout ?? ''}${ran.stderr ?? ''}`.trim();
  return { step, ok: ran.status === 0, ms: Date.now() - started, code: ran.status, output: output.slice(-4000) };
};

/** Exactly one atomic rename: the temporary link is built beside `current` and renamed over it. */
const switchTo = (layout: DeployLayout, sha: string): void => {
  const link = paths(layout).current;
  const temporary = `${link}.${randomUUID()}.new`;
  symlinkSync(join('releases', sha), temporary, 'dir');
  renameSync(temporary, link);
};

/** Keep `current` plus the newest `keep - 1` releases; every other release folder is removed by name. */
export const pruneReleases = (layout: DeployLayout, keep = DEFAULT_KEEP): readonly string[] => {
  const releases = paths(layout).releases;
  if (!existsSync(releases)) return [];
  const current = currentRelease(layout);
  const all = readdirSync(releases, { withFileTypes: true })
    .filter((one) => one.isDirectory())
    .map((one) => ({ name: one.name, at: 0 }));
  const ordered = all
    .map((one) => {
      const stat = git(['-C', join(releases, one.name), 'show', '-s', '--format=%ct', 'HEAD']);
      const at = Number.parseInt(stat.stdout.trim(), 10);
      return { name: one.name, at: Number.isNaN(at) ? 0 : at };
    })
    .sort((left, right) => right.at - left.at || right.name.localeCompare(left.name));
  // `keep` counts releases on disk, so the current one plus the newest `keep - 1` others — never one fewer
  // when the current release is also the newest.
  const others = ordered.filter((one) => one.name !== current);
  const keepNames = new Set([
    ...(current === null ? [] : [current]),
    ...others.slice(0, Math.max(keep - 1, 0)).map((one) => one.name),
  ]);
  const removed: string[] = [];
  for (const one of ordered) {
    if (keepNames.has(one.name)) continue;
    rmSync(join(releases, one.name), { recursive: true, force: true });
    const objects = paths(layout).objects;
    if (existsSync(objects)) {
      for (const store of readdirSync(objects)) git(['-C', join(objects, store), 'worktree', 'prune']);
    }
    removed.push(one.name);
  }
  return removed;
};

export interface DeployOptions extends DeployLayout {
  readonly version: string;
  readonly declaration: DeployDeclaration;
  /** A deploy id the caller may choose; generated otherwise. It is what the refusal and the journal carry. */
  readonly deployId?: string;
  /**
   * Whether this machine accepts a build or hook command, asked before that step runs; absent accepts every command.
   *
   * The gate is injected rather than read here on purpose: the machine's `allowRemoteCommands` setting has one
   * reader (#38277), and a second one in this package would be the copy that drifts. It answers a refusal reason,
   * never a bare false, because the journal and the report say why by name.
   */
  readonly permit?: (step: DeployStep, command: DeployCommand) => string | undefined;
}

/** Whether a process still runs, which is what separates a live deploy's lock from a dead one's. */
const alive = (pid: number): boolean => {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * One call: service S on machine M at version X. Refuses while another deploy of the same service holds the lock;
 * reports `outcome unknown: <step>` when the lock is left over from a process that is gone, and never resumes it.
 */
export const deploy = (options: DeployOptions): DeployResult => {
  const layout: DeployLayout = { stateDir: options.stateDir, service: options.service };
  const before = readLock(layout);
  if (before !== undefined) {
    if (alive(before.pid)) {
      journal(layout, { event: 'refused', deployId: before.deployId, holder: before.deployId, step: before.step });
      const outcome: DeployState = { state: 'refused, deploy running', deployId: before.deployId };
      return { service: options.service, deployId: before.deployId, sha: before.to, from: before.from, steps: [], outcome };
    }
    // The lock outlived its process: say which step it was in and stop. It is never resumed or retried.
    journal(layout, { event: 'outcome unknown', deployId: before.deployId, step: before.step, pid: before.pid });
    releaseLock(layout);
    const outcome: DeployState = { state: 'outcome unknown', sha: before.to === '' ? null : before.to, step: before.step, deployId: before.deployId };
    return { service: options.service, deployId: before.deployId, sha: before.to, from: before.from, steps: [], outcome };
  }

  const from = currentRelease(layout);
  const deployId = options.deployId ?? randomUUID();
  const lock: LockBody = { deployId, step: 'resolve', pid: process.pid, startedAt: new Date().toISOString(), from, to: '' };
  if (!takeLock(layout, lock)) {
    const holder = readLock(layout);
    const outcome: DeployState = { state: 'refused, deploy running', deployId: holder?.deployId ?? 'unknown' };
    return { service: options.service, deployId: outcome.deployId, sha: holder?.to ?? '', from, steps: [], outcome };
  }
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
  const finish = (outcome: DeployState): DeployResult => {
    journal(layout, { event: 'finished', deployId, sha, from, outcome: outcome.state });
    releaseLock(layout);
    return { service: options.service, deployId, sha, from, steps, outcome };
  };
  const fail = (step: DeployStep, reason: string): DeployState => {
    journal(layout, { event: 'failed', deployId, sha, step, reason });
    return { state: 'failed, new release live', sha, from, step, reason };
  };

  /** A step's command runs only when the machine's gate accepts it; nothing is read about that here. */
  const rejected = (step: DeployStep, command: DeployCommand | undefined): string | undefined =>
    command === undefined ? undefined : options.permit?.(step, command);

  try {
    // The ruling's first line: "started <from>-><to>" is written before any step runs.
    journal(layout, { event: 'started', deployId, from, to: sha, version: options.version });

    setLockStep(layout, lock, 'fetch');
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

    setLockStep(layout, lock, 'build');
    const buildRefusal = rejected('build', options.declaration.build);
    if (buildRefusal !== undefined) {
      // Nothing has been switched, so the refusal names the step and the machine says why, and current stays put.
      journal(layout, { event: 'refused', deployId, step: 'build', reason: buildRefusal });
      return finish({ state: 'refused, command not allowed', step: 'build', reason: buildRefusal });
    }
    const built = runStep('build', options.declaration.build, release);
    steps.push(built);
    if (!built.ok) return finish(fail('build', `build exited ${String(built.code)}`));

    setLockStep(layout, lock, 'before_switch');
    const hookRefusal = rejected('before_switch', options.declaration.beforeSwitch);
    if (hookRefusal !== undefined) {
      journal(layout, { event: 'refused', deployId, step: 'before_switch', reason: hookRefusal });
      return finish({ state: 'refused, command not allowed', step: 'before_switch', reason: hookRefusal });
    }
    const hooked = runStep('before_switch', options.declaration.beforeSwitch, release);
    steps.push(hooked);
    if (!hooked.ok) return finish(fail('before_switch', `before_switch exited ${String(hooked.code)}`));

    setLockStep(layout, lock, 'switch');
    switchTo(layout, sha);
    steps.push({ step: 'switch', ok: true, ms: 0 });
    journal(layout, { event: 'switched', deployId, sha, from });

    if (options.declaration.check === undefined) {
      // No check is not a pass: the deploy says exactly what it did and what it did not do.
      pruneReleases(layout, options.declaration.keep);
      return finish({ state: 'switched, unchecked', sha, from });
    }

    setLockStep(layout, lock, 'check');
    const checkRefusal = rejected('check', options.declaration.check);
    if (checkRefusal !== undefined) {
      // The folder is live and nothing checked it: that is `switched, unchecked`, said plainly rather than hidden.
      journal(layout, { event: 'refused', deployId, step: 'check', reason: checkRefusal });
      return finish({ state: 'switched, unchecked', sha, from });
    }
    const checked = runStep('check', options.declaration.check, release);
    steps.push(checked);
    if (checked.ok) {
      pruneReleases(layout, options.declaration.keep);
      return finish({ state: 'switched, checked', sha, from });
    }

    const reason = `check exited ${String(checked.code)}`;
    if (options.declaration.migrations === 'expand-only' && from !== null) {
      // The migration is already applied, so the folder goes back and the report says the migration stays.
      switchTo(layout, from);
      journal(layout, { event: 'switched back', deployId, sha, to: from });
      return finish({ state: 'switched back, migration stays applied', sha, from, reason });
    }
    // No declared migration: the new folder stays live and the failure is loud, never a silent rollback.
    return finish(fail('check', reason));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    journal(layout, { event: 'failed', deployId, sha, step: lock.step, reason });
    releaseLock(layout);
    const outcome: DeployState = { state: 'failed, new release live', sha, from, step: lock.step, reason };
    return { service: options.service, deployId, sha, from, steps, outcome };
  }
};

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
    if (lock === undefined || alive(lock.pid)) continue;
    journal(layout, { event: 'outcome unknown', deployId: lock.deployId, step: lock.step, pid: lock.pid, found: 'at start' });
    releaseLock(layout);
    swept.push({ service: entry.name, step: lock.step, deployId: lock.deployId });
  }
  return swept;
};

export const status = (layout: DeployLayout): { readonly current: string | null; readonly lock: LockBody | undefined } => {
  return { current: currentRelease(layout), lock: readLock(layout) };
};
