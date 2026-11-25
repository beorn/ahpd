/**
 * The worktrees this host still has to remove, as records a pass works
 * through: VS Code's pending worktree removals.
 *
 * A removal that cannot happen now - work nobody synced, a session using the
 * folder, git refusing - stays as a record with its status and is tried again:
 * every 5 minutes while one remains, and a failure after a wait of 30 s
 * doubled per attempt, up to an hour. The records outlive a restart through the
 * port the daemon hands in; without one they live as long as the host.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts
 */

/** How a removal went, as `vscode/sessionWorktreeCleanup` answers it. */
export interface WorktreeCleanupStatus {
  state: 'unknown' | 'pending' | 'running' | 'inUse' | 'skipped' | 'failed';
  message?: string;
}

/** One worktree to remove. */
export interface WorktreeRemoval {
  /** `session` for a tree an archived session gave back; `managed` for one a client asked to clean up. */
  kind: 'session' | 'managed';
  /** The session for `session`, the worktree's path for `managed`. */
  owner: string;
  repository: string;
  path: string;
  branch?: string;
  /** `synced` removes only a tree whose branch is pushed; `commit` commits what is dirty first, where the host allows it. */
  mode: 'synced' | 'commit';
  /** When it was asked, increasing, so a newer request is told from an older one. */
  requestedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastAttempt?: WorktreeCleanupStatus;
}

/** Where the records are kept. */
export interface WorktreeRemovalStore {
  list(): WorktreeRemoval[];
  /** Keep a record, in place of one of the same kind, owner and path. */
  put(removal: WorktreeRemoval): void;
  delete(kind: WorktreeRemoval['kind'], owner: string, path: string): void;
}

/** Records kept in memory, for a host whose daemon hands in no store. */
export const memoryWorktreeRemovals = (): WorktreeRemovalStore => {
  const held = new Map<string, WorktreeRemoval>();
  const key = (kind: string, owner: string, path: string): string => `${kind}\u0000${owner}\u0000${path}`;
  return {
    list: () => [...held.values()].map((one) => ({ ...one })),
    put: (removal) => { held.set(key(removal.kind, removal.owner, removal.path), { ...removal }); },
    delete: (kind, owner, path) => { held.delete(key(kind, owner, path)); },
  };
};

/** What processing one record came to. */
export type RemovalOutcome =
  | { kind: 'removed' }
  | { kind: 'dropped' }
  | { kind: 'inUse' }
  | { kind: 'skipped'; message: string }
  | { kind: 'failed'; message: string };

/** The waits a queue keeps, which a test shortens. */
export interface RemovalTimings {
  debounceMs: number;
  periodicMs: number;
  backoffMs: number;
  maxBackoffMs: number;
  now: () => number;
}

export const DEFAULT_REMOVAL_TIMINGS: RemovalTimings = {
  debounceMs: 3_000,
  periodicMs: 5 * 60 * 1000,
  backoffMs: 30 * 1000,
  maxBackoffMs: 60 * 60 * 1000,
  now: Date.now,
};

/** Attempts after which a failing removal is logged as a warning, as VS Code logs it. */
const WARN_AFTER_ATTEMPTS = 5;

/** The order a session's statuses are answered in: the first one found wins. */
const STATUS_ORDER: WorktreeCleanupStatus['state'][] = ['running', 'pending', 'failed', 'inUse', 'skipped', 'unknown'];

export interface WorktreeRemovalQueue {
  /** Ask for a removal, replacing a record of the same tree, and run a pass soon. */
  request(removal: Omit<WorktreeRemoval, 'requestedAt' | 'attempts' | 'nextAttemptAt'>): void;
  /** Drop every record a session owns, as an unarchive does. */
  dropSession(session: string): void;
  /** The records a session owns. */
  ofSession(session: string): WorktreeRemoval[];
  /** The record of a managed worktree, where there is one. */
  managed(path: string): WorktreeRemoval | undefined;
  /** How a record stands now: its live status, or its last attempt, or `pending`. */
  statusOf(removal: WorktreeRemoval): WorktreeCleanupStatus;
  /** A session's status, by VS Code's order. */
  sessionStatus(session: string, inUse: (removal: WorktreeRemoval) => boolean): WorktreeCleanupStatus;
  /** Process records now, forced; answers the records that remain. */
  processNow(removals: readonly WorktreeRemoval[], force: boolean): Promise<WorktreeRemoval[]>;
  /** Run a pass over the due records. */
  runPass(): Promise<void>;
  /** Run a pass after `ms` when the store holds records, as a restart does with what it left. */
  resume(ms: number): void;
  /** Let go of the timers. */
  stop(): void;
}

/**
 * The queue around a store and the processing of one record.
 *
 * `process` runs a record's checks and its removal, and answers how it went:
 * `removed` and `dropped` take the record out, `inUse` and `skipped` keep it
 * for a later pass, and `failed` keeps it until its wait is over.
 */
export const createWorktreeRemovalQueue = (
  store: WorktreeRemovalStore,
  process: (removal: WorktreeRemoval, force: boolean) => Promise<RemovalOutcome>,
  log: { info(message: string): void; warn(message: string): void },
  timings: RemovalTimings = DEFAULT_REMOVAL_TIMINGS,
): WorktreeRemovalQueue => {
  const live = new Map<string, { requestedAt: number; status: WorktreeCleanupStatus }>();
  const keyOf = (one: WorktreeRemoval): string => `${one.kind}\u0000${one.owner}\u0000${one.path}`;
  let lastRequestedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<void> | undefined;
  let again = false;
  let stopped = false;

  const arm = (ms: number): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void runPass(); }, ms);
    timer.unref?.();
  };

  const current = (one: WorktreeRemoval): WorktreeRemoval | undefined =>
    store.list().find((other) => keyOf(other) === keyOf(one));

  const handle = async (one: WorktreeRemoval, force: boolean): Promise<void> => {
    const now = timings.now();
    live.set(keyOf(one), { requestedAt: one.requestedAt, status: { state: 'running' } });
    let outcome: RemovalOutcome;
    try { outcome = await process(one, force); }
    catch (error) { outcome = { kind: 'failed', message: error instanceof Error ? error.message : String(error) }; }
    // A newer request for the same tree, made while this one ran, is the one that stands.
    const still = current(one);
    if (still === undefined || still.requestedAt !== one.requestedAt) {
      live.delete(keyOf(one));
      return;
    }
    if (outcome.kind === 'removed' || outcome.kind === 'dropped') {
      store.delete(one.kind, one.owner, one.path);
      live.delete(keyOf(one));
      return;
    }
    if (outcome.kind === 'inUse') {
      live.set(keyOf(one), { requestedAt: one.requestedAt, status: { state: 'inUse' } });
      return;
    }
    const wait = Math.min(timings.maxBackoffMs, timings.backoffMs * 2 ** one.attempts);
    const status: WorktreeCleanupStatus = { state: outcome.kind, message: outcome.message };
    const attempts = one.attempts + 1;
    store.put({ ...one, attempts, nextAttemptAt: now + wait, lastAttempt: status });
    live.set(keyOf(one), { requestedAt: one.requestedAt, status });
    if (outcome.kind === 'failed') {
      const said = `worktree cleanup: could not remove ${one.path} (attempt ${String(attempts)}): ${outcome.message}`;
      if (attempts >= WARN_AFTER_ATTEMPTS) log.warn(said); else log.info(said);
    }
  };

  const once = async (): Promise<void> => {
    const now = timings.now();
    const records = store.list();
    const keys = new Set(records.map(keyOf));
    for (const key of [...live.keys()]) if (!keys.has(key)) live.delete(key);
    for (const one of records) {
      if (stopped) return;
      if (one.nextAttemptAt <= now) await handle(one, false);
    }
  };

  const runPass = (): Promise<void> => {
    if (pass !== undefined) {
      again = true;
      return pass;
    }
    pass = (async () => {
      try {
        do {
          again = false;
          await once();
        } while (again && !stopped);
      }
      catch (error) {
        log.warn(`worktree cleanup: a pass failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      finally {
        pass = undefined;
      }
      // While records remain, a failed one at its next attempt, and the rest every few minutes.
      const remaining = store.list();
      if (remaining.length === 0 || stopped) return;
      const now = timings.now();
      const delay = Math.min(timings.periodicMs, ...remaining.map((one) => (one.nextAttemptAt > now ? one.nextAttemptAt - now : timings.periodicMs)));
      arm(Math.max(timings.debounceMs, delay));
    })();
    return pass;
  };

  const statusOf = (one: WorktreeRemoval): WorktreeCleanupStatus => {
    const known = live.get(keyOf(one));
    if (known !== undefined && known.requestedAt === one.requestedAt) return known.status;
    return one.lastAttempt ?? { state: one.attempts > 0 ? 'unknown' : 'pending' };
  };

  return {
    request: (asked) => {
      // Strictly increasing, so a request never reuses the time of the one it replaces.
      lastRequestedAt = Math.max(timings.now(), lastRequestedAt + 1);
      store.put({ ...asked, requestedAt: lastRequestedAt, attempts: 0, nextAttemptAt: 0 });
      arm(timings.debounceMs);
    },
    dropSession: (session) => {
      for (const one of store.list()) if (one.kind === 'session' && one.owner === session) {
        store.delete(one.kind, one.owner, one.path);
        live.delete(keyOf(one));
      }
    },
    ofSession: (session) => store.list().filter((one) => one.kind === 'session' && one.owner === session),
    managed: (path) => store.list().find((one) => one.kind === 'managed' && one.path === path),
    statusOf,
    sessionStatus: (session, inUse) => {
      const statuses = store.list().filter((one) => one.kind === 'session' && one.owner === session).map((one) => {
        const known = live.get(keyOf(one));
        if (known !== undefined && known.requestedAt === one.requestedAt) return known.status;
        if (inUse(one)) return { state: 'inUse' } as const;
        return statusOf(one);
      });
      for (const state of STATUS_ORDER) {
        const found = statuses.find((one) => one.state === state);
        if (found !== undefined) return found;
      }
      return { state: 'unknown' };
    },
    processNow: async (removals, force) => {
      for (const one of removals) {
        const held = current(one);
        if (held !== undefined) await handle(held, force);
      }
      return removals.map(current).filter((one): one is WorktreeRemoval => one !== undefined);
    },
    runPass,
    resume: (ms) => { if (store.list().length > 0) arm(ms); },
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
};
