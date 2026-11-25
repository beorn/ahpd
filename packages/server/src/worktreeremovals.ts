/**
 * The worktree removals still to make, kept in one JSON file beside the
 * configuration, so a restart tries them again as VS Code's host does from
 * its database.
 */
import { readJsonObject, writeJsonAtomic } from '@ahpd/sdk';
import type { WorktreeRemoval, WorktreeRemovalStore } from '@ahpd/sdk';

/** The file's shape: a version, and the records. */
interface Held {
  version: 1;
  removals: WorktreeRemoval[];
}

const keyOf = (kind: string, owner: string, path: string): string => `${kind}\u0000${owner}\u0000${path}`;

/** The records in `file`, written whole after each change. A file that cannot be read starts empty, and is said. */
export const fileWorktreeRemovals = (file: string, told: (line: string) => void = () => {}): WorktreeRemovalStore => {
  const held = new Map<string, WorktreeRemoval>();
  const outcome = readJsonObject(file);
  const read = outcome.ok ? outcome.value as Partial<Held> : undefined;
  if (!outcome.ok && outcome.kind !== 'missing') told(`${file} could not be read (${outcome.kind}); starting with no worktree removals`);
  else if (read !== undefined && (read.version !== 1 || !Array.isArray(read.removals))) told(`${file} is not a worktree removal file this version reads; starting with none`);
  else for (const one of read?.removals ?? []) {
    if (typeof one?.path === 'string' && typeof one.owner === 'string' && (one.kind === 'session' || one.kind === 'managed')) held.set(keyOf(one.kind, one.owner, one.path), one);
  }
  const save = (): void => { writeJsonAtomic(file, { version: 1, removals: [...held.values()] } satisfies Held); };
  return {
    list: () => [...held.values()].map((one) => ({ ...one })),
    put: (removal) => { held.set(keyOf(removal.kind, removal.owner, removal.path), { ...removal }); save(); },
    delete: (kind, owner, path) => { if (held.delete(keyOf(kind, owner, path))) save(); },
  };
};
