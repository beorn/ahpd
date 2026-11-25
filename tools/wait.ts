/*
 * How long a case waits for a condition by the clock before it fails.
 *
 * Most of the case's own budget - 20 s on Windows and 5 s elsewhere, in
 * `vitest.config.ts` - so a slow runner is given the time the case has, and
 * the wait still fails with its own words before vitest times the case out. A
 * fixed 3 s ran out on a busy Windows runner while two attachments were still
 * being written.
 */
export const WAIT_MS = process.platform === 'win32' ? 15_000 : 4_000;

/*
 * The budget of a case that starts scripted CLIs as processes of their own,
 * set by its file with `vi.setConfig`.
 *
 * Each call to a scripted `docker`, `devcontainer` or `virsh` is a node
 * process, and a case with a few connects needs more than 5 s on a busy
 * machine. Windows' 20 s for every platform, for these files alone.
 */
export const PROCESS_CASE_MS = 20_000;

/*
 * The budget of a case whose first import of a plugin's source is the work
 * under test, set by its file or its block.
 *
 * The import goes through vite's transform, which takes about 2 s for a
 * plugin on an idle machine and more than 5 s at a load near 15.
 */
export const IMPORT_CASE_MS = 20_000;
