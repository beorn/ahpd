import { posix, win32 } from 'node:path';

/** How one program is started: what `spawn` is given. */
export interface Launch {
  /** The program to start, which is a path rather than a name when npm is the `.js` one. */
  command: string;
  /** Its arguments, already quoted when a shell is the one that reads them. */
  args: string[];
  /** Whether a shell reads the command line, which `cmd.exe` has to for npm. */
  shell: boolean;
}

/**
 * How a program is started on `platform`.
 *
 * Every program but npm is started by its name, with its arguments as they are.
 * npm is started as this Node itself, with npm's own `npm-cli.js` as its first
 * argument, so the npm that runs is the one this daemon runs under, at whatever
 * version and in whatever folder that is, and not the first `npm` on a PATH
 * that a service manager or a desktop session set. On Windows it is also the
 * only way to start npm without a shell: npm is `npm.cmd` there, and Node
 * refuses to spawn a `.cmd` file without one - the fix for CVE-2024-27980 - so
 * `npm.cmd` by its name fails with `ENOENT` just as `npm` does.
 *
 * The script comes from `npm_execpath` when npm set it and it names
 * `npm-cli.js`, and from npm's usual place beside `execPath` otherwise:
 * `node_modules\npm` in Node's folder on Windows, `../lib/node_modules/npm`
 * from it elsewhere. Away from Windows only a program named `node` or `nodejs`
 * is taken as Node, since Bun or Deno beside a Node install is not one. Neither
 * there is a Node whose npm is somewhere else, such as a distribution's, and
 * npm is then run by its name: on Windows through the shell, each argument in
 * double quotes because the shell is what splits the line.
 *
 * `platform` decides, and the paths are read as that platform's, so a case on
 * Linux hands the Windows branch the `C:\...` paths a Windows machine would
 * have.
 */
export const launch = (
  program: string,
  argv: readonly string[],
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  execPath: string,
  exists: (path: string) => boolean,
): Launch => {
  if (program !== 'npm') return { command: program, args: [...argv], shell: false };
  const windows = platform === 'win32';
  const path = windows ? win32 : posix;
  const node = windows || /^node(js)?$/.test(posix.basename(execPath));
  const named = env.npm_execpath;
  const beside = windows
    ? win32.join(win32.dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : posix.join(posix.dirname(execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const cli = !node ? undefined
    : named !== undefined && path.basename(named) === 'npm-cli.js' && exists(named) ? named
    : exists(beside) ? beside : undefined;
  if (cli !== undefined) return { command: execPath, args: [cli, ...argv], shell: false };
  if (windows) return { command: program, args: argv.map((one) => `"${one}"`), shell: true };
  return { command: program, args: [...argv], shell: false };
};
