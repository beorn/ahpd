/** The trees a session's changes are measured between, held by this host and named by no ref. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_TURN } from '../types/changes.js';
import { runGit } from '../repo/hardened.js';

/*
 * Why a checkpoint at all.
 *
 * Git answers what a working tree looks like now, which is not what a session
 * did: a commit takes that answer to zero, and two sessions in one folder have
 * the same one. A checkpoint is the tree as it was at a moment only the
 * session knows about - before its first turn, and at the end of each of them
 * - so the difference between two of them is that session's own work.
 *
 * Why a tree and nothing more.
 *
 * Each checkpoint is a tree object written into the repository's object store
 * and named by nothing there: no commit, no ref. A ref per turn is what piled
 * up under `refs/agents/` in every folder a session ran in, and every ref is
 * something a person's `git for-each-ref`, `git log --all` and every client
 * that lists refs has to read past. The tree's name is held here, in this
 * host's memory, for as long as the host runs.
 *
 * What that costs is said rather than hidden. A tree nothing names is one git
 * may collect (`git gc` prunes unreachable objects older than
 * `gc.pruneExpire`, and all of them with `--prune=now`), and a host that
 * restarts has forgotten every name it held. Either is a session with no
 * baseline, and a session with no baseline has counts nobody can give: they
 * are unknown, with the reason, never zero and never the edit tracker's
 * partial answer passed off as the whole.
 */

/**
 * One `git` run, as text, or nothing when it would not run.
 *
 * The same shape as the source's own runner, with an environment a caller can
 * add to: staging into an index of this call's own is the whole trick below,
 * and `GIT_INDEX_FILE` is what says which index.
 */
const git = (dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | undefined> =>
  new Promise((answer) => {
    runGit(dir, args, {
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...env },
      // No console window on Windows, where each checkpoint's `git.exe` would
      // open one.
      windowsHide: true,
    }, (error, out) => answer(error ? undefined : out));
  });

/**
 * The working tree, written as a tree object and nothing else.
 *
 * Two commands and an index of this call's own: `add -A` fills it from the
 * working tree and `write-tree` turns it into a tree object. Nothing moves the
 * person's branch, index or working tree - the index `add` writes is
 * `GIT_INDEX_FILE`'s, in a directory that is removed after - and nothing names
 * the tree: no `commit-tree`, no `update-ref`.
 */
const writeTree = async (dir: string): Promise<string | undefined> => {
  const staging = await mkdtemp(join(tmpdir(), 'ahpd-checkpoint-')).catch(() => undefined);
  if (staging === undefined) return undefined;
  try {
    const env = { GIT_INDEX_FILE: join(staging, 'index') };
    if (await git(dir, ['add', '-A'], env) === undefined) return undefined;
    const tree = (await git(dir, ['write-tree'], env))?.trim();
    return tree === undefined || tree === '' ? undefined : tree;
  }
  catch {
    // A temporary directory this process may not make is the one failure that
    // reaches here, and it is a tree that was not written.
    return undefined;
  }
  finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Whether a directory is in a work tree git will answer for. */
const isRepository = async (dir: string): Promise<boolean> =>
  (await git(dir, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true';

/** Whether the repository at `dir` still holds a tree of that name. */
const hasTree = async (dir: string, tree: string): Promise<boolean> =>
  await git(dir, ['cat-file', '-e', `${tree}^{tree}`]) !== undefined;

/**
 * The two ends a session's changes are a difference between, as far as this
 * host knows them.
 *
 * `none` is a folder that is not a repository, where there are no trees and
 * the edit tracker is the only account there is. `unknown` is a repository
 * where the session's baseline is not held, or is no longer in it, with the
 * reason. `known` has the baseline, and the last finished turn's tree where a
 * turn has finished.
 */
export type CheckpointEnds =
  | { kind: 'none' }
  | { kind: 'unknown'; reason: string }
  | { kind: 'known'; baseline: string; latest?: string };

/** One source's checkpoints, held per session. */
export interface SessionTrees {
  /**
   * Write the tree as it is now: the baseline under {@link BASELINE_TURN},
   * kept from its first write on, and a turn's under its own id, which
   * replaces the turn before it. A turn is written only where the session has
   * a baseline, since it is a difference from that.
   */
  capture(dir: string, session: string, turn: string): Promise<void>;
  /** Where the session's two ends are, read again against the repository. */
  ends(dir: string, session: string): Promise<CheckpointEnds>;
  /** Let go of a session's trees, which is all removing them takes. */
  forget(session: string): void;
}

/**
 * The checkpoints of every session one source serves.
 *
 * Keyed by the session alone: the objects are the repository's, shared by
 * every worktree of it, so a session that moves into a worktree of the same
 * repository keeps its baseline, and one that moves into another repository
 * finds it missing there and says so.
 */
export const sessionTrees = (): SessionTrees => {
  const held = new Map<string, { baseline?: string; latest?: string; failed?: string }>();

  /*
   * The captures of one session, one at a time.
   *
   * A baseline and the turn that follows it are two writes, and the second is
   * only worth writing where the first has landed: the host asks for the
   * baseline as a session starts and does not wait for it, so the first turn
   * of a fast session can end before its baseline is written. Chained rather
   * than guarded, so the order the host asked in is the order they run, and a
   * read waits for the writes asked for before it.
   */
  const capturing = new Map<string, Promise<void>>();
  const inOrder = async (session: string, work: () => Promise<void>): Promise<void> => {
    const before = capturing.get(session) ?? Promise.resolve();
    // The work runs after a failure as well: one capture that could not be
    // written is not a reason the next one is not.
    const next = before.then(work, work);
    capturing.set(session, next);
    await next;
    if (capturing.get(session) === next) capturing.delete(session);
  };

  const capture = async (dir: string, session: string, turn: string): Promise<void> => {
    // A turn the backend named with nothing at all is no tree to write.
    if (turn === '') return;
    await inOrder(session, async () => {
      const mine = held.get(session) ?? {};
      if (turn === BASELINE_TURN) {
        // The tree as the session found it, written once: a session started
        // again in this host keeps the one it began from.
        if (mine.baseline !== undefined) return;
        const tree = await writeTree(dir);
        if (tree !== undefined) {
          held.set(session, { baseline: tree });
          return;
        }
        // A folder that is not a repository has no trees, and that is the
        // answer rather than a failure; one that is had a tree not written.
        if (await isRepository(dir)) held.set(session, { failed: `git could not write the tree of ${dir} as the session found it` });
        return;
      }
      if (mine.baseline === undefined) return;
      const tree = await writeTree(dir);
      if (tree !== undefined) held.set(session, { ...mine, latest: tree });
    });
  };

  const ends = async (dir: string, session: string): Promise<CheckpointEnds> => {
    // The writes asked for before this read are part of what it reads.
    await capturing.get(session);
    if (!await isRepository(dir)) return { kind: 'none' };
    const mine = held.get(session);
    if (mine?.failed !== undefined) return { kind: 'unknown', reason: `no baseline: ${mine.failed}` };
    if (mine?.baseline === undefined) {
      return {
        kind: 'unknown',
        reason: 'no baseline: this host holds no tree of the folder as the session found it, '
          + 'because the session started before this host process did',
      };
    }
    for (const [which, tree] of [['baseline', mine.baseline], ['last turn', mine.latest]] as const) {
      if (tree !== undefined && !await hasTree(dir, tree)) {
        return {
          kind: 'unknown',
          reason: `no baseline: the ${which} tree ${tree} is not in the repository at ${dir}; `
            + 'git collected it, or the session moved to another repository',
        };
      }
    }
    return { kind: 'known', baseline: mine.baseline, ...(mine.latest === undefined ? {} : { latest: mine.latest }) };
  };

  return { capture, ends, forget: (session) => { held.delete(session); } };
};

/**
 * Every ref a session left under `refs/agents/`, gone.
 *
 * Nothing here writes one any more; builds before this one did, a commit per
 * turn under `refs/agents/<session>/checkpoints/turn/<turn>`, and nothing else
 * will ever remove those. The namespace is the session's own, so nothing
 * anybody else wrote is in what is read here.
 */
export const removeAll = async (dir: string, session: string): Promise<void> => {
  const segment = session.replace(/[^A-Za-z0-9._-]/g, '-');
  const said = await git(dir, ['for-each-ref', '--format=%(refname)', `refs/agents/${segment}/checkpoints/`]);
  if (said === undefined) return;
  for (const ref of said.split('\n').map((line) => line.trim()).filter((line) => line !== '')) {
    await git(dir, ['update-ref', '-d', ref]);
  }
};
