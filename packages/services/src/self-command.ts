import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The words every wrapper line carries after the executable word. */
export const WRAPPER_WORDS = 'secrets exec';

/** The bare word a checkout lands on: nothing beside the module ships an executable. */
export const WRAPPER_BARE = 'ahpd';

/**
 * How many parent directories {@link wrapperExecutable} climbs before it gives up. A packaged install puts
 * `bin/ahpd` five climbs above `…/packages/services/dist` or `…/node_modules/@ahpd/services/dist`; two more
 * cover an install that keeps the packages under an extra directory.
 */
const CLIMBS = 7;

/**
 * The executable a wrapper line should name (#39156 B). A packaged install answers with the absolute path of
 * the `bin/ahpd` above its own module, so a process-compose row cannot resolve a different ahpd than the one
 * that wrote it: `PATH` on a service unit is the inherited projection, and a bare `ahpd` there has already
 * started a row on an older build that refused the line the driver wrote. The climb stops at the first `.git`
 * above the module, so a checkout — where `PATH` is the only stable word and every test and dev run writes
 * today's line — answers the bare `ahpd` even when an unrelated `bin/ahpd` sits above the repository.
 */
export function wrapperExecutable(moduleUrl: string, exists: (path: string) => boolean = existsSync): string {
  let at = dirname(fileURLToPath(moduleUrl));
  for (let climbed = 0; climbed < CLIMBS; climbed += 1) {
    const candidate = join(at, 'bin', 'ahpd');
    if (exists(candidate)) return candidate;
    if (exists(join(at, '.git'))) break;
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return WRAPPER_BARE;
}

let cached: string | undefined;

/** {@link wrapperExecutable} for this install, read once: the answer cannot change while the process runs. */
export function ownWrapperExecutable(): string {
  cached ??= wrapperExecutable(import.meta.url);
  return cached;
}

/** Whether `native` is a secrets wrapper line, whichever executable word it names. */
export function isWrapperCommand(native: string): boolean {
  const words = `${WRAPPER_WORDS} `;
  if (native.startsWith(`${WRAPPER_BARE} ${words}`)) return true;
  const absolute = /^\/\S*\/bin\/ahpd /u.exec(native);
  return absolute !== null && native.slice(absolute[0].length).startsWith(words);
}
