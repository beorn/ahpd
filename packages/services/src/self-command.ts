import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The words every wrapper line carries after the executable word. */
export const WRAPPER_WORDS = 'secrets exec';

/** The bare word a checkout lands on: nothing beside the module ships an executable. */
export const WRAPPER_BARE = 'ahpd';

/** The executable word a packaged install ships: a fixed name beside the install's own library tree. */
/**
 * How many parent directories {@link wrapperExecutable} climbs before it gives up. A packaged install puts
 * `bin/ahpd` above `lib/…/node_modules/@ahpd/<package>/dist`, five climbs from the module; two more cover an
 * install that keeps the packages under an extra directory.
 */
const CLIMBS = 7;

/**
 * The executable a wrapper line should name (#39156 B). A packaged install answers with the absolute path of
 * the `bin/ahpd` above its own module, so a process-compose row cannot resolve a different ahpd than the one
 * that wrote it: `PATH` on a service unit is the inherited projection, and a bare `ahpd` there has already
 * started a row on an older build that refused the line the driver wrote. Only a path that runs through a
 * `node_modules` tree can be packaged this way, so a checkout — where no `bin/ahpd` sits above the module
 * either way — answers the bare `ahpd`, the stable word in that layout, and every test and dev run keeps the
 * line it wrote before.
 */
export function wrapperExecutable(moduleUrl: string, exists: (path: string) => boolean = existsSync): string {
  const here = fileURLToPath(moduleUrl);
  const insidePackages = here.includes(`${sep}node_modules${sep}`);
  let at = dirname(here);
  for (let climbed = 0; climbed < CLIMBS; climbed += 1) {
    const candidate = join(at, 'bin', 'ahpd');
    if (insidePackages && here !== candidate && exists(candidate)) return candidate;
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
