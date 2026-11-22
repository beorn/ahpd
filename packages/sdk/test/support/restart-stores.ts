/*
 * A restart on the same folder, in one test process (#37472).
 *
 * A session folder has one writer per process: a second store on it is refused
 * until the first lets go. A case that restarts a host on the same folder is a
 * new process in production, where the old one's lock went with it; here the
 * old store is still open. So opening a store on a folder first closes the one
 * this file opened on it before, as a stopped process would.
 *
 * Teardown closes what is left. A case that removed its folder in its own
 * finally leaves a store whose last write is refused by name; close() still
 * lets go of the folder (#37472), so only that refusal, for a removed folder,
 * is let pass.
 */

import { existsSync } from 'node:fs';
import { afterEach } from 'vitest';
import { fileSessions as openFileSessions } from '../../src/sessions/sessions.js';
import type { SessionStore } from '../../src/types/sessions.js';

const open = new Map<string, SessionStore>();

export const fileSessions: typeof openFileSessions = (options) => {
  open.get(options.dir)?.close?.();
  const store = openFileSessions(options);
  open.set(options.dir, store);
  return store;
};

afterEach(() => {
  for (const [dir, store] of open) {
    try { store.close?.(); }
    catch (error) {
      if (existsSync(dir)) throw error;
    }
  }
  open.clear();
});
