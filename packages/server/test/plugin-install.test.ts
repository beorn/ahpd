import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { fittingVersion, installPlugins, isPackageName, launch, packageOf, pinned, removePlugins, run as realRun, updatePlugins } from '../src/install.js';
import type { Ran, Runner } from '../src/install.js';
import { registry } from '../src/update.js';
import type { Fetch } from '../src/update.js';
import { readInstalled, recordInstalled, refreshMarketplace } from '../src/pluginlist.js';
import type { ListedPlugin, ListedVersion } from '../src/pluginlist.js';

/*
 * `ahpd plugin install` and `ahpd plugin remove`, without npm.
 *
 * Every case here is about the two things this command owns: the argument
 * list npm is given, and the edit `config.json` gets. The runner is a fake, so
 * no case needs a registry, a network or a package, and the configuration is a
 * temporary directory rather than the one this machine would write.
 */

let root: string;
let configDir: string;
let configFile: string;
let hadRoot: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-install-'));
  configDir = join(root, 'ahpd');
  configFile = join(configDir, 'config.json');
  hadRoot = process.env.AHPD_PLUGIN_ROOT;
  delete process.env.AHPD_PLUGIN_ROOT;
});
afterEach(() => {
  if (hadRoot === undefined) delete process.env.AHPD_PLUGIN_ROOT; else process.env.AHPD_PLUGIN_ROOT = hadRoot;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A package name the registry has, as `installPlugins` recognises one, so the
 * fake lands a manifest only for the sources npm resolves that way. A path, a
 * URL or a git spec is named by what `added` says it became.
 */
const registryName = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/**
 * A runner that records every call and lets a verb fail. `lands` is what an
 * install leaves in `node_modules`, as a package name and its version.
 *
 * `answers` is keyed by the program's verb, or by the last argument, so a case
 * can fail the one package of an update, which gets a call of its own. The
 * packages land where the call's own `--prefix` says, which is what npm does: a
 * case that moves the root sees them under the root.
 *
 * `added` is what npm writes into the root's `package.json` dependencies, which
 * is how an install of a source learns what npm called the package; `manifests`
 * is what each landed `package.json` says besides its name and version, so a
 * case can land one with an `ahpd` field and one without.
 *
 * An install's own sources land too, as npm leaves them: every registry name
 * after the `--` gets a manifest with an `ahpd` field, because npm really does
 * put one in `node_modules`. An update's argv has no `--`, so its cases land
 * only what `lands` names and a package npm did not move stays where it was;
 * what it lands is the package's own `package.json`, so it carries the `ahpd`
 * field a plugin's does unless the case says otherwise.
 */
const fake = (
  answers: Record<string, Ran> = {},
  lands: Record<string, string> = {},
  options: { added?: Record<string, string>; manifests?: Record<string, Record<string, unknown>> } = {},
) => {
  const calls: { program: string; argv: string[] }[] = [];
  const runner: Runner = async (program, argv) => {
    calls.push({ program, argv: [...argv] });
    const answer = answers[argv[0] ?? ''] ?? answers[argv.at(-1) ?? ''] ?? { code: 0, stdout: '', stderr: '' };
    const at = argv.indexOf('--prefix');
    if (argv[0] === 'install' && answer.code === 0 && at !== -1) {
      const into = argv[at + 1] as string;
      const landed = new Map(Object.entries(lands));
      const sources = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
      for (const source of sources) {
        const name = packageOf(source);
        if (!registryName.test(name) || landed.has(name)) continue;
        landed.set(name, source.slice(name.length + 1) || '0.1.0');
      }
      for (const [name, version] of landed) {
        mkdirSync(join(into, 'node_modules', name), { recursive: true });
        // A source written `name@version` lands that version, as npm does, so a
        // put-back is a real one.
        const asked = argv.find((one) => one.startsWith(`${name}@`));
        // A tag such as `@latest` is what npm is asked for, not the version it
        // resolves to, so only a version written as one is landed as written.
        const named = asked === undefined ? undefined : asked.slice(name.length + 1);
        const exact = named !== undefined && /^\d/u.test(named) ? named : undefined;
        // A manifest this case names is written as it is, for the version the
        // case lands; a version written back is the one that was there before,
        // so it carries the plain `ahpd` field a plugin's did.
        const written = lands[name] === undefined || exact === undefined || exact === lands[name];
        const said = written ? options.manifests?.[name] : undefined;
        writeFileSync(join(into, 'node_modules', name, 'package.json'), JSON.stringify({
          name,
          version: exact ?? version,
          ...(said ?? { ahpd: { entry: './index.js' } }),
        }));
      }
      if (options.added !== undefined) {
        const file = join(into, 'package.json');
        const held = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
        const dependencies = typeof held.dependencies === 'object' && held.dependencies !== null
          ? held.dependencies as Record<string, string>
          : {};
        held.dependencies = { ...dependencies, ...options.added };
        writeFileSync(file, `${JSON.stringify(held, null, 2)}\n`);
      }
    }
    return answer;
  };
  return { runner, calls };
};

/**
 * A registry that has every name it is asked about, at one version, `0.1.0`,
 * whose manifest carries an `ahpd` field and declares no `@ahpd/sdk` range, so
 * every daemon is admitted. A path that names a version or a tag is that
 * version's manifest; a path that is only a name is the package's metadata.
 */
const aPlugin: Fetch = async (url) => {
  const path = String(url).slice(registry().length + 1);
  return path.includes('/')
    ? Response.json({ version: '0.1.0', ahpd: { entry: './dist/index.js' } })
    : Response.json(packument(['0.1.0']));
};

/**
 * A registry with the manifests given, by the path after the registry's base:
 * an object is a manifest, `404` is a missing version, and an `Error` is a
 * request that never answered. Every path asked is recorded.
 */
const fakeRegistry = (answers: Record<string, object | 404 | Error>) => {
  const asked: string[] = [];
  const fetch: Fetch = async (url) => {
    const path = String(url).slice(registry().length + 1);
    asked.push(path);
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    if (answer === undefined || answer === 404) return new Response('{"error":"Not found"}', { status: 404 });
    return Response.json(answer);
  };
  return { fetch, asked };
};

/**
 * A package's abbreviated metadata for `fakeRegistry`: each version written as
 * `<version>` or `<version> <@ahpd/sdk peer range>`, and `latest` naming the
 * version the publisher calls current, which is the last one given.
 */
const packument = (versions: string[], latest: string = versions.at(-1) as string): object => ({
  'dist-tags': { latest },
  versions: Object.fromEntries(versions.map((held) => {
    const [version, range] = held.split(' ');
    return [version as string, range === undefined ? {} : { peerDependencies: { '@ahpd/sdk': range } }];
  })),
});

const said: string[] = [];
const say = (line: string): void => { said.push(line); };

const write = (held: unknown): void => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(held, null, 2)}\n`);
};
const read = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;

/*
 * Starting npm as the Node the daemon runs under, which on Windows is also how
 * npm's `.cmd` is avoided.
 *
 * The cases drive the pure function with the platform, the environment and the
 * paths a machine would have, because the build runs on Linux and the spawn
 * itself is the one part of this that a machine here cannot hold.
 */

it('starts a program other than npm by its name with the arguments unchanged', () => {
  // Only npm is a `.cmd` on Windows; `git`, `gh` and `ssh` are `.exe` files, and
  // a shell would only be one more thing between the daemon and the program.
  const env = { npm_execpath: 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' };
  expect(launch('git', ['status'], 'win32', env, 'C:\\nodejs\\node.exe', () => false))
    .toEqual({ command: 'git', args: ['status'], shell: false });
  expect(launch('git', ['status'], 'linux', {}, '/usr/bin/node', () => true))
    .toEqual({ command: 'git', args: ['status'], shell: false });
});

it('starts npm as node with the npm-cli.js beside it, on Linux', () => {
  // A Node from a version manager keeps its npm beside it, and that npm is the
  // one to run, not the first `npm` on the PATH.
  const node = '/home/softov/.nvm/versions/node/v22.18.0/bin/node';
  const cli = '/home/softov/.nvm/versions/node/v22.18.0/lib/node_modules/npm/bin/npm-cli.js';
  expect(launch('npm', ['install', '--prefix', '/tmp/ahpd'], 'linux', {}, node, (at) => at === cli))
    .toEqual({ command: node, args: [cli, 'install', '--prefix', '/tmp/ahpd'], shell: false });
});

it('takes the npm-cli.js beside node when npm named another program, on macOS', () => {
  const node = '/opt/homebrew/Cellar/node/22.18.0/bin/node';
  const cli = '/opt/homebrew/Cellar/node/22.18.0/lib/node_modules/npm/bin/npm-cli.js';
  const env = { npm_execpath: '/Users/softov/Library/pnpm/pnpm.cjs' };
  expect(launch('npm', ['install'], 'darwin', env, node, (at) => at === cli))
    .toEqual({ command: node, args: [cli, 'install'], shell: false });
});

it('starts npm by its name, with no shell, when no npm-cli.js is there, on Linux', () => {
  // A distribution's Node keeps npm in a folder of its own.
  expect(launch('npm', ['install', '--prefix', '/tmp/ahpd'], 'linux', {}, '/usr/bin/node', () => false))
    .toEqual({ command: 'npm', args: ['install', '--prefix', '/tmp/ahpd'], shell: false });
});

it('starts npm by its name when the daemon runs under Bun, on Linux', () => {
  // Bun beside a Node install would find that Node's npm-cli.js, which Bun is
  // not the Node to run.
  expect(launch('npm', ['install'], 'linux', {}, '/usr/local/bin/bun', () => true))
    .toEqual({ command: 'npm', args: ['install'], shell: false });
});

it('starts npm as node with the npm-cli.js npm names, on Windows', () => {
  const cli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  // The script is where npm says it is, so nothing is looked for beside node.
  expect(launch('npm', ['install', 'left-pad'], 'win32', { npm_execpath: cli }, 'C:\\Program Files\\nodejs\\node.exe', (at) => at === cli))
    .toEqual({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [cli, 'install', 'left-pad'], shell: false });
});

it('takes the npm-cli.js beside node when npm named another program, on Windows', () => {
  // A daemon started by pnpm is told pnpm's own script, which is not npm's.
  const beside = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const env = { npm_execpath: 'C:\\Users\\softov\\AppData\\Roaming\\npm\\pnpm.cjs' };
  expect(launch('npm', ['install'], 'win32', env, 'C:\\Program Files\\nodejs\\node.exe', (at) => at === beside))
    .toEqual({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [beside, 'install'], shell: false });
});

it('runs npm through the shell, with each argument in double quotes, when no npm-cli.js is there', () => {
  // A version manager's Node keeps npm in its own folder, so neither path is
  // there: `npm` goes to the shell, and the shell is what splits the line.
  const env = { npm_execpath: 'C:\\Users\\softov\\AppData\\Roaming\\npm\\pnpm.cjs' };
  expect(launch('npm', ['install', '--prefix', 'C:\\Program Files\\ahpd'], 'win32', env, 'C:\\nodejs\\node.exe', () => false))
    .toEqual({ command: 'npm', args: ['"install"', '"--prefix"', '"C:\\Program Files\\ahpd"'], shell: true });
});

it('pins the sdk to the daemon\'s version, which is the one name ahpd pins', () => {
  // The daemon owns `@ahpd/sdk` and installs it beside every plugin, whatever
  // range a plugin declares; a version or tag written on it is the writer's.
  expect(pinned('@ahpd/sdk', '9.9.9')).toBe('@ahpd/sdk@9.9.9');
  expect(pinned('@ahpd/sdk@1', '9.9.9')).toBe('@ahpd/sdk@1');
  // An unknown version is left for npm's own `latest` rather than becoming
  // `@unknown`.
  expect(pinned('@ahpd/sdk', 'unknown')).toBe('@ahpd/sdk');
});

/*
 * Choosing a plugin's version: what the package declares it works with decides
 * it, not the version number it carries and not the daemon's own version.
 */
it('chooses the version whose sdk range admits this daemon', async () => {
  const { fetch, asked } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
  // One request, for the package's own metadata, at the registry's own path
  // for a scoped name.
  expect(asked).toEqual(['@ahpd%2fweb']);
});

it('asks for the abbreviated packument, not the whole one', async () => {
  const accepts: string[] = [];
  const fetch: Fetch = async (_url, init) => {
    accepts.push((init?.headers as Record<string, string> | undefined)?.accept ?? '');
    return Response.json(packument(['0.1.0 >=0.9']));
  };
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
  expect(accepts).toEqual(['application/vnd.npm.install-v1+json']);
});

it('takes the newest version that admits the daemon, over one published ahead of it', async () => {
  // The newest version asks for an sdk this daemon is not yet, so the newest
  // one that does not is the one to install.
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 >=0.10', '0.3.0 >=0.11']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.2.0');
});

it('chooses no prerelease for an sdk that is a release', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.2.0-beta.1 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

/*
 * An sdk that is a prerelease takes the prereleases whose range admits it,
 * above `latest`, which is the last release.
 */
it('chooses the release candidate whose range admits an sdk that is a release candidate', async () => {
  const versions = ['0.14.0 >=0.10 <1', '0.15.0-rc.3 >=0.15.0-rc.3 <0.16.0-0', '0.15.0-rc.4 >=0.15.0-rc.4 <0.16.0-0'];
  const { fetch } = fakeRegistry({ '@ahpd%2fagent-acp': packument(versions, '0.14.0') });
  expect(await fittingVersion('@ahpd/agent-acp', '0.15.0-rc.4', { fetch })).toBe('0.15.0-rc.4');
  expect(await fittingVersion('@ahpd/agent-acp', '0.15.0-rc.3', { fetch })).toBe('0.15.0-rc.3');
  expect(await fittingVersion('@ahpd/agent-acp', '0.14.0', { fetch })).toBe('0.14.0');
});

it('keeps the latest limit for a release, also on an sdk that is a release candidate', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.3.0 >=0.9', '0.4.0-rc.1 >=0.9'], '0.1.0') });
  expect(await fittingVersion('@ahpd/web', '0.15.0-rc.4', { fetch })).toBe('0.4.0-rc.1');
  const { fetch: noRc } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.3.0 >=0.9'], '0.1.0') });
  expect(await fittingVersion('@ahpd/web', '0.15.0-rc.4', { fetch: noRc })).toBe('0.1.0');
});

it('never chooses a version above the one the publisher calls latest', async () => {
  // A publisher who moved `latest` back chose the newest version to install.
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9', '0.3.0 >=0.9'], '0.1.0') });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

it('chooses a version that declares no sdk range, which the loader loads unchecked', async () => {
  const { fetch } = fakeRegistry({ 'left-pad': packument(['1.3.0']) });
  expect(await fittingVersion('left-pad', '0.10.0', { fetch })).toBe('1.3.0');
});

it('skips a version whose range this daemon cannot read, as the loader would refuse it', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 ~>0.9', '0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', '0.10.0', { fetch })).toBe('0.1.0');
});

it('chooses no version when the registry does not answer', async () => {
  const { fetch, asked } = fakeRegistry({
    'offline': new TypeError('fetch failed'),
    'missing': 404,
    'not-a-packument': { name: 'not-a-packument', 'dist-tags': { latest: '1.0.0' } },
  });
  expect(await fittingVersion('offline', '0.10.0', { fetch })).toBeUndefined();
  expect(await fittingVersion('missing', '0.10.0', { fetch })).toBeUndefined();
  expect(await fittingVersion('not-a-packument', '0.10.0', { fetch })).toBeUndefined();
  expect(asked).toEqual(['offline', 'missing', 'not-a-packument']);
});

it('chooses no version when the daemon\'s own version is unknown, and asks nothing', async () => {
  // Nothing can be compared against `unknown`, so npm's own `latest` decides.
  const { fetch, asked } = fakeRegistry({ '@ahpd%2fweb': packument(['0.1.0 >=0.9']) });
  expect(await fittingVersion('@ahpd/web', 'unknown', { fetch })).toBeUndefined();
  expect(asked).toEqual([]);
});

it('refuses a package with no version that admits the daemon, naming the newest range', async () => {
  const { fetch } = fakeRegistry({ '@ahpd%2fweb': packument(['0.2.0 >=0.11', '0.3.0 >=0.11']) });
  await expect(fittingVersion('@ahpd/web', '0.10.0', { fetch }))
    .rejects.toThrow('@ahpd/web has no version that admits @ahpd/sdk 0.10.0: its newest, 0.3.0, needs >=0.11.');
});

it('recognises the specs it can install and refuses the rest', () => {
  expect(isPackageName('@ahpd/agent-claude')).toBe(true);
  expect(isPackageName({ name: '@ahpd/agent-claude', enabled: false })).toBe(true);
  // A path is used as written and a scheme is the runtime's to resolve.
  expect(isPackageName('./my-plugin')).toBe(false);
  expect(isPackageName('../my-plugin')).toBe(false);
  expect(isPackageName('/opt/my-plugin')).toBe(false);
  expect(isPackageName('npm:@ahpd/agent-claude')).toBe(false);
  expect(isPackageName('https://example.test/plugin.js')).toBe(false);
});

it('installs into the configuration directory and names the packages there', async () => {
  // Nothing sets the root outside the ahpd part, so this is the one place a
  // plugin lands when the variable is absent.
  expect(process.env.AHPD_PLUGIN_ROOT).toBeUndefined();
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-claude', 'left-pad@1'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  });

  const install = calls.find((one) => one.argv[0] === 'install');
  expect(install?.program).toBe('npm');
  // No `--allow-scripts`: npm 12 refuses that flag on a project-scoped
  // install, and the only thing it would have built here is the SDK's
  // optional node-pty, which the daemon gets from its own global install.
  expect(install?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@9.9.9',
    '--', '@ahpd/agent-claude@0.1.0', 'left-pad@1',
  ]);
  // The list holds package names, which is what the loader resolves: a
  // version or tag belongs to the install and would read back as missing.
  expect(read().plugins).toEqual(['@ahpd/agent-claude', 'left-pad']);
  expect(said.join('\n')).toContain(configDir);
});

it('installs into the plugin root when the variable is set, and still configures the daemon', async () => {
  // Inside the ahpd part the config dir is not writable and every plugin has to
  // be somewhere the part's launcher will point `ahpd plugin install` at.
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-cofold'], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  });

  expect(calls.find((one) => one.argv[0] === 'install')?.argv)
    .toEqual(['install', '--prefix', pluginRoot, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '--', '@ahpd/agent-cofold@0.1.0']);
  expect(existsSync(pluginRoot)).toBe(true);
  expect(said.join('\n')).toContain(pluginRoot);
  // The root moves where the packages land and nothing else: the configuration
  // file is still the daemon's own, in its own directory.
  expect(read().plugins).toEqual(['@ahpd/agent-cofold']);
  expect(configFile.startsWith(configDir)).toBe(true);
});

it('names a scoped package without the version it was installed at', async () => {
  const { runner, calls } = fake();
  await installPlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say });
  expect(calls.find((one) => one.argv[0] === 'install')?.argv.at(-1)).toBe('@ahpd/agent-acp@0.7.0');
  expect(read().plugins).toEqual(['@ahpd/agent-acp']);
});

it('removes a name given with a version', async () => {
  write({ plugins: ['@ahpd/agent-acp'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/agent-acp@0.7.0'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv.at(-1)).toBe('@ahpd/agent-acp');
});

it('installs a source npm resolves, and names it by the package npm wrote', async () => {
  // A `github:` spec is npm's to resolve, so nothing asks the registry and npm
  // is handed the source as it was written. What `plugins` names is the
  // dependency npm added for it, which is the name the loader resolves.
  const { runner, calls } = fake({}, { demo: '0.1.0' }, {
    added: { demo: 'github:someone/demo' },
    manifests: { demo: { ahpd: { entry: './index.js' } } },
  });
  expect(await installPlugins(['github:someone/demo'], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(calls.find((one) => one.argv[0] === 'install')?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '--', 'github:someone/demo',
  ]);
  expect(read().plugins).toEqual(['demo']);
});

it('takes a path and a tarball URL the same way, naming each by what npm added', async () => {
  // npm writes a path as a `file:` spec beside the root, which is resolved
  // back to the path it was given; a URL is written as it was given.
  const plugin = join(root, 'my-plugin');
  const tarball = 'https://example.test/tools/demo.tgz';
  const { runner, calls } = fake({}, { demo: '0.1.0', other: '0.2.0' }, {
    added: { demo: 'file:../my-plugin', other: tarball },
    manifests: { demo: { ahpd: {} }, other: { ahpd: {} } },
  });
  expect(await installPlugins([plugin, tarball], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo', 'other']);
  expect(calls.find((one) => one.argv[0] === 'install')?.argv.slice(-2)).toEqual([plugin, tarball]);
  expect(read().plugins).toEqual(['demo', 'other']);
});

it('names a path by what npm added when the root is reached through a symbolic link', async () => {
  // npm writes the `file:` spec from the root's real path, so it climbs out of
  // the folder the link points at. The sdk pin is added beside it, as npm adds
  // it on a first install, so the path is named by its spec and not by being
  // the one dependency added.
  const real = join(root, 'deep', 'er', 'ahpd');
  mkdirSync(real, { recursive: true });
  // A junction on Windows, which links a folder with no privilege and resolves as a link does.
  symlinkSync(real, configDir, posix ? 'dir' : 'junction');
  const plugin = join(root, 'my-plugin');
  mkdirSync(plugin);
  const { runner } = fake({}, { demo: '0.1.0' }, {
    added: { '@ahpd/sdk': '^0.8.0', demo: 'file:../../../my-plugin' },
    manifests: { demo: { ahpd: {} } },
  });
  expect(await installPlugins([plugin], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(read().plugins).toEqual(['demo']);
});

it('names a path by what npm added when the path goes through a symbolic link', async () => {
  // npm takes a folder's real path before it writes the spec, so a path given
  // through a link is written as the folder the link points at.
  const away = join(root, 'deep', 'er');
  mkdirSync(join(away, 'my-plugin'), { recursive: true });
  symlinkSync(away, join(root, 'link'), posix ? 'dir' : 'junction');
  const { runner } = fake({}, { demo: '0.1.0' }, {
    added: { '@ahpd/sdk': '^0.8.0', demo: 'file:../deep/er/my-plugin' },
    manifests: { demo: { ahpd: {} } },
  });
  expect(await installPlugins([join(root, 'link', 'my-plugin')], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).toEqual(['demo']);
  expect(read().plugins).toEqual(['demo']);
});

it('uninstalls and refuses a source whose package has no ahpd field', async () => {
  // The registry cannot be asked about a source, so what npm landed is what
  // decides: a package that is not an ahpd plugin goes out again, and nothing
  // is written into `plugins`.
  const { runner, calls } = fake({}, { demo: '0.1.0' }, {
    added: { demo: 'github:someone/demo' },
    manifests: { demo: { bin: { demo: './dist/main.js' } } },
  });
  await expect(installPlugins(['github:someone/demo'], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('demo is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls.map((one) => one.argv[0])).toEqual(['install', 'uninstall']);
  expect(calls[1]?.argv).toEqual(['uninstall', '--prefix', configDir, '--legacy-peer-deps', '--', 'demo']);
  expect(existsSync(configFile)).toBe(false);
});

it('uninstalls and refuses a source whose package landed no manifest at all', async () => {
  // npm succeeded and wrote a dependency, but no `node_modules/<name>/package.json`
  // is there: nothing was landed, or npm could not write what it landed. There
  // is no `ahpd` field to read either, so the source is refused as the one with
  // no field is, and the package npm named is taken out again.
  const { runner, calls } = fake({}, {}, { added: { demo: 'github:someone/demo' } });
  await expect(installPlugins(['github:someone/demo'], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('demo is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls.map((one) => one.argv[0])).toEqual(['install', 'uninstall']);
  expect(calls[1]?.argv).toEqual(['uninstall', '--prefix', configDir, '--legacy-peer-deps', '--', 'demo']);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses a source that would be read by npm as an option, before npm runs', async () => {
  // `--prefix=/x` is a source only in appearance: npm would take it as an
  // option, so it never reaches npm, and nothing is written anywhere.
  const { runner, calls } = fake();
  await expect(installPlugins(['--prefix=/x'], {
    configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('--prefix=/x is not a source to install: a source that starts with "-" would be read by npm as an option.');
  expect(calls).toEqual([]);
  expect(existsSync(configFile)).toBe(false);
});

it('refuses to remove a name that would be read by npm as an option, before npm runs', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await expect(removePlugins(['--prefix=/x'], { configDir, configFile, uninstall: true, run: runner, say }))
    .rejects.toThrow('--prefix=/x is not a plugin to remove: a name that starts with "-" would be read by npm as an option.');
  expect(calls).toEqual([]);
  expect(read().plugins).toEqual(['@ahpd/a']);
});

it('adds a name once, and keeps every other key and entry', async () => {
  write({ port: 1234, plugins: ['@ahpd/existing', { name: '@ahpd/configured', options: { token: 'shh' } }] });
  const { runner } = fake();
  await installPlugins(['@ahpd/existing', '@ahpd/agent-claude'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  });

  const held = read();
  expect(held.port).toBe(1234);
  // The object entry keeps its options, and the name already there is not
  // replaced by a bare string.
  expect(held.plugins).toEqual([
    '@ahpd/existing',
    { name: '@ahpd/configured', options: { token: 'shh' } },
    '@ahpd/agent-claude',
  ]);
  // Two-space JSON with a trailing newline, the shape every other writer uses.
  const text = readFileSync(configFile, 'utf8');
  expect(text).toContain('\n  "port": 1234');
  expect(text.endsWith('\n')).toBe(true);

  // A second install of the same name changes nothing, file included.
  await installPlugins(['@ahpd/agent-claude'], { configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say });
  expect(readFileSync(configFile, 'utf8')).toBe(text);
});

it('leaves the configuration alone with --no-enable', async () => {
  write({ plugins: ['@ahpd/other'] });
  const before = readFileSync(configFile, 'utf8');
  const { runner } = fake();
  await installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(readFileSync(configFile, 'utf8')).toBe(before);
  // And one that is not there is not created, which is what the container
  // install relies on.
  rmSync(configFile);
  await installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(existsSync(configFile)).toBe(false);
});

it('removes a string entry and an object entry, then uninstalls them', async () => {
  write({ port: 1234, plugins: ['@ahpd/a', { name: '@ahpd/b', options: { x: 1 } }, '@ahpd/c'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a', '@ahpd/b'], { configDir, configFile, uninstall: true, run: runner, say });

  expect(read().plugins).toEqual(['@ahpd/c']);
  expect(read().port).toBe(1234);
  expect(calls.find((one) => one.argv[0] === 'uninstall')?.argv)
    .toEqual(['uninstall', '--prefix', configDir, '--legacy-peer-deps', '--', '@ahpd/a', '@ahpd/b']);
});

it('drops the name with --keep but leaves the package installed', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a'], { configDir, configFile, uninstall: false, run: runner, say });
  expect(read().plugins).toEqual([]);
  expect(calls).toEqual([]);
});

it('refuses with npm\'s own words when the install fails', async () => {
  const { runner } = fake({ install: { code: 1, stdout: '', stderr: 'E404 no such package' } });
  await expect(installPlugins(['@ahpd/agent-claude'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow(/@ahpd\/agent-claude: E404 no such package/);
  // Nothing was named, because nothing was installed.
  expect(existsSync(configFile)).toBe(false);
});

/*
 * npm can be loud, and what it says is the reason a person is reading the line
 * it is on. The copy the caller gets is the whole of it, whatever its size.
 */
it('streams more from npm than one buffer holds', async () => {
  const real = process.stderr.write;
  let heard = '';
  process.stderr.write = ((chunk: string | Uint8Array) => { heard += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    const done = await realRun('node', ['-e', 'process.stderr.write("x".repeat(2 * 1024 * 1024))']);
    expect(done.code).toBe(0);
    expect(done.stderr.length).toBe(2 * 1024 * 1024);
    expect(heard.length).toBe(2 * 1024 * 1024);
  }
  finally {
    process.stderr.write = real;
  }
}, 30000);

/** A plugin root as npm leaves it: `package.json` and each package's own. */
const installed = (packages: Record<string, string>, dir: string = configDir): void => {
  mkdirSync(dir, { recursive: true });
  const dependencies = Object.fromEntries(Object.entries(packages).map(([name, version]) => [name, `^${version}`]));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ dependencies }, null, 2)}\n`);
  for (const [name, version] of Object.entries(packages)) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    // The package.json npm left there, which for a plugin carries its `ahpd`
    // field; the sdk is not a plugin and has none.
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
      name,
      version,
      ...(name === '@ahpd/sdk' ? {} : { ahpd: { entry: './index.js' } }),
    }));
  }
};

/**
 * A registry that holds one version of each package named, written as
 * `<version> <@ahpd/sdk range>`; a package left out is one it does not have.
 * That one version is the only one there is, so it is also `latest`.
 */
const registryHolding = (packages: Record<string, string>): Fetch => fakeRegistry(Object.fromEntries(
  Object.entries(packages).map(([name, held]) => [name.replace('/', '%2f'), packument([held])]),
)).fetch;

// VS Code's update of every extension answers each on its own
// (extensionsWorkbenchService.ts L2088-L2105, abstractExtensionManagementService.ts
// L193-L215 at 6b68d3fe).
it('updates every installed package in an npm call of its own, each to the newest version that fits it', async () => {
  installed({
    '@ahpd/agent-acp': '0.7.0',
    '@ahpd/agent-claude': '0.7.0',
    '@ahpd/agent-cofold': '0.7.0',
    '@ahpd/computer': '0.7.0',
    'left-pad': '1.0.0',
  });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-acp': '0.8.0', 'left-pad': '1.3.0' });
  await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say,
    fetch: registryHolding({
      '@ahpd/agent-acp': '0.8.0 >=0.8',
      '@ahpd/agent-claude': '0.8.0 >=0.8',
      '@ahpd/agent-cofold': '0.8.0 >=0.8',
      '@ahpd/computer': '0.8.0 >=0.8',
      // A package outside this project is chosen by the same rule, its range
      // included, and one that declares none is admitted as it is.
      'left-pad': '1.3.0',
    }),
  });

  const each = ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0'];
  expect(calls).toEqual([
    { program: 'npm', argv: [...each, '@ahpd/agent-acp@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/agent-claude@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/agent-cofold@0.8.0'] },
    { program: 'npm', argv: [...each, '@ahpd/computer@0.8.0'] },
    { program: 'npm', argv: [...each, 'left-pad@1.3.0'] },
  ]);
  // Each move, from the version that was installed to the one npm left, and
  // nothing for a package npm did not move.
  expect(said).toContain('@ahpd/agent-acp: 0.7.0 to 0.8.0');
  expect(said).toContain('left-pad: 1.0.0 to 1.3.0');
  expect(said.filter((line) => line.startsWith('@ahpd/agent-claude:'))).toEqual([]);
});

it('moves a plugin published on its own schedule to the version its own range admits', async () => {
  // The case this rule comes from: `@ahpd/web` is released on its own, at a
  // version that asks for an sdk the daemon already is.
  installed({ '@ahpd/web': '0.1.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/web': '0.2.0', 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.10.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/web': '0.2.0 >=0.9', 'left-pad': '1.3.0' }),
  })).toEqual([{ name: '@ahpd/web', from: '0.1.0', to: '0.2.0' }, { name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['@ahpd/web@0.2.0', 'left-pad@1.3.0']);
  expect(calls[0]?.argv).toEqual([
    'install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.10.0', '@ahpd/web@0.2.0',
  ]);
});

it('says a package with no version that fits, leaves it, and moves the others', async () => {
  installed({ '@ahpd/web': '0.1.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.10.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/web': '0.3.0 >=0.11', 'left-pad': '1.3.0' }),
  })).toEqual([{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(said).toEqual([
    '@ahpd/web has no version that admits @ahpd/sdk 0.10.0: its newest, 0.3.0, needs >=0.11.',
    'Updating left-pad@1.3.0 with npm.',
    'left-pad: 1.0.0 to 1.3.0',
  ]);
  // Only the package that can move is asked of npm.
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad@1.3.0']);
});

it('moves a package to latest when the registry cannot say which version fits', async () => {
  installed({ 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', { configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .toEqual([{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad@latest']);
});

it('runs no npm when nothing is installed', async () => {
  said.length = 0;
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({});
  await updatePlugins('all', { configDir, sdk: '0.8.0', run: runner, say, fetch });
  installed({});
  await updatePlugins('all', { configDir, sdk: '0.8.0', run: runner, say, fetch });
  expect(calls).toEqual([]);
  expect(asked).toEqual([]);
  expect(said).toEqual([`No plugin is installed in ${configDir}.`, `No plugin is installed in ${configDir}.`]);
});

it('fails an update with npm\'s reason, once, naming the package npm refused', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner } = fake({ install: { code: 1, stdout: '', stderr: 'E404 no such package' } });
  const failed = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  }).catch((error: unknown) => error as Error);
  expect(failed).toBeInstanceOf(Error);
  expect((failed as Error).message).toBe('npm could not update @ahpd/agent-claude: E404 no such package');
});

it('moves the others, and names the one npm cannot install', async () => {
  installed({ '@ahpd/agent-acme': '0.7.0', '@ahpd/agent-claude': '0.7.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, calls } = fake(
    { '@ahpd/agent-acme@0.8.0': { code: 1, stdout: '', stderr: 'E404 no such package' } },
    { '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' },
  );
  const failed = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say,
    fetch: registryHolding({
      '@ahpd/agent-acme': '0.8.0 >=0.8',
      '@ahpd/agent-claude': '0.8.0 >=0.8',
      'left-pad': '1.3.0',
    }),
  }).catch((error: unknown) => error as Error);
  // One npm call each, so the one npm cannot install is the only one left
  // where it was, and the rest moved and were said.
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-acme@0.8.0'],
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', 'left-pad@1.3.0'],
  ]);
  expect(said).toEqual([
    'Updating @ahpd/agent-acme@0.8.0 with npm.',
    'Updating @ahpd/agent-claude@0.8.0 with npm.',
    'Updating left-pad@1.3.0 with npm.',
    '@ahpd/agent-claude: 0.7.0 to 0.8.0',
    'left-pad: 1.0.0 to 1.3.0',
  ]);
  expect((failed as Error).message).toBe('npm could not update @ahpd/agent-acme: E404 no such package');
});

it('leaves a package installed from outside the registry as it is, and says so', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const dependencies = {
    '@ahpd/agent-claude': '^0.7.0',
    'mine-path': '../mine',
    'mine-file': 'file:../mine',
    'mine-link': 'link:../mine',
    'mine-git': 'git+https://example.test/mine.git',
    'mine-github': 'github:someone/mine',
    'mine-git-plain': 'git://example.test/mine.git',
    'mine-tarball': 'https://example.test/mine.tgz',
  };
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies }));
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  const moved = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  });
  expect(calls.map((one) => one.argv)).toEqual([['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0']]);
  expect(moved).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  for (const [name, spec] of Object.entries(dependencies).slice(1)) {
    expect(said).toContain(`${name}: ${spec}, left as installed`);
  }
});

it('runs no npm when every package came from outside the registry, and says there was nothing to update', async () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({ dependencies: { mine: 'file:../mine' } }));
  said.length = 0;
  const { runner, calls } = fake();
  expect(await updatePlugins('all', { configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({}) })).toEqual([]);
  expect(calls).toEqual([]);
  expect(said).toEqual(['mine: file:../mine, left as installed', 'Nothing to update.']);
});

it('puts back the version it moved from when the new manifest holds a list the loader would refuse', async () => {
  // npm replaces the package before anything can read it, so the check runs on
  // what landed: a list the loader refuses at the next start would leave a
  // plugin that worked yesterday broken today, with no way back but a manual
  // install.
  installed({ '@ahpd/probe-grants': '0.1.0' });
  write({ plugins: [{ source: '@ahpd/probe-grants', grants: ['probe:read'] }] });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/probe-grants': '0.2.0' }, {
    manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: 'probe:read' } } },
  });
  const failed = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/probe-grants': '0.2.0 >=0.8' }),
  }).then(() => undefined, (error: unknown) => String(error));
  expect(failed).toContain('is not a list of grants');
  expect(calls.some((one) => one.argv[0] === 'install' && one.argv.includes('@ahpd/probe-grants@0.1.0'))).toBe(true);
  expect(failed).toContain('The version it moved from was put back');
  // The put-back is a real one: the version on disk is the one that worked,
  // and nothing says the move it undid.
  expect(JSON.parse(readFileSync(join(configDir, 'node_modules', '@ahpd/probe-grants', 'package.json'), 'utf8')).version).toBe('0.1.0');
  expect(said.join('\n')).not.toContain('to 0.2.0');
});

it('carries what one package moved when another is refused in the same call', async () => {
  // A refusal ends the command, and the package that moved before it is on disk
  // and not running: the error names it, so a command can import it again.
  installed({ '@ahpd/probe-one': '0.1.0', '@ahpd/probe-two': '0.1.0' });
  said.length = 0;
  const { runner } = fake({}, { '@ahpd/probe-one': '0.2.0', '@ahpd/probe-two': '0.2.0' }, {
    manifests: { '@ahpd/probe-two': { ahpd: { entry: './index.js', grants: 'probe:read' } } },
  });
  const failed = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/probe-one': '0.2.0 >=0.8', '@ahpd/probe-two': '0.2.0 >=0.8' }),
  }).then(() => undefined, (error: unknown) => error as { moved?: { name: string; to?: string }[] });
  expect(String(failed)).toContain('is not a list of grants');
  expect(failed?.moved?.map((one) => [one.name, one.to])).toEqual([['@ahpd/probe-one', '0.2.0']]);
});

it('puts back the version it moved from when the new version is not a plugin at all', async () => {
  installed({ '@ahpd/probe-grants': '0.1.0' });
  write({ plugins: [{ source: '@ahpd/probe-grants' }] });
  said.length = 0;
  const { runner } = fake({}, { '@ahpd/probe-grants': '0.2.0' }, { manifests: { '@ahpd/probe-grants': { bin: {} } } });
  const failed = await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/probe-grants': '0.2.0 >=0.8' }),
  }).then(() => undefined, (error: unknown) => String(error));
  expect(failed).toContain('is not an ahpd plugin');
  expect(JSON.parse(readFileSync(join(configDir, 'node_modules', '@ahpd/probe-grants', 'package.json'), 'utf8')).version).toBe('0.1.0');
});

it('checks nothing about a package npm left at the version it was', async () => {
  // The version on disk is the one that was there, so there is no new manifest
  // to hold to anything: a list the loader would refuse stays where it is,
  // because this call is not what put it there.
  installed({ '@ahpd/probe-grants': '0.2.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/probe-grants': '0.2.0' }, {
    manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: 'probe:read' } } },
  });
  await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/probe-grants': '0.2.0 >=0.8' }),
  });
  expect(said.join('\n')).not.toContain('is not a list of grants');
  // Nothing was put back over it: one npm call, which installed the version
  // that was already there.
  expect(calls).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(configDir, 'node_modules', '@ahpd/probe-grants', 'package.json'), 'utf8')).ahpd.grants).toBe('probe:read');
});

it('holds a package npm left where it was to the integrity its list names', async () => {
  // A call that moved nothing still has to answer for what is on disk: the
  // record that says this package came from that list is written only when the
  // list's own value is the one npm installed.
  installed({ '@ahpd/agent-acp': '0.13.0' });
  await listed(OURS, [acp([listedVersion('0.13.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-other' } }, { '@ahpd/agent-acp': '0.13.0' });
  await expect(updatePlugins('all', {
    configDir, sdk: '0.15.0', run: runner, fetch: aPlugin, say, marketplaces: [OURS],
  })).rejects.toThrow(`@ahpd/agent-acp 0.13.0 is not the one ${OURS} lists`);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['@ahpd/agent-acp@0.13.0', '@ahpd/agent-acp@0.13.0']);
});

it('says what a moved version asks its entry for, and what the entry holds that it no longer asks for', async () => {
  installed({ '@ahpd/probe-grants': '0.1.0' });
  write({ plugins: [{ source: '@ahpd/probe-grants', grants: ['probe:read', 'probe:delete'] }] });
  said.length = 0;
  const { runner } = fake({}, { '@ahpd/probe-grants': '0.2.0' }, {
    manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: ['probe:read', 'probe:write'] } } },
  });
  await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/probe-grants': '0.2.0 >=0.8' }),
  });
  const lines = said.join('\n');
  expect(lines).toContain('@ahpd/probe-grants asks for probe:write, which its entry does not hold');
  expect(lines).toContain('@ahpd/probe-grants holds probe:delete, which its manifest no longer asks for');
});

it('reports an sdk the update moved while no plugin did', async () => {
  // Every update installs the daemon's sdk beside the plugins, so an sdk one
  // minor behind moves on a call that moves no plugin at all: the daemon has
  // to be restarted for the plugins to load the new one.
  installed({ '@ahpd/agent-claude': '0.8.0', '@ahpd/sdk': '0.7.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/sdk': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/sdk', from: '0.7.0', to: '0.8.0' }]);
  expect(calls).toHaveLength(1);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/sdk: 0.7.0 to 0.8.0']);
});

it('updates from the plugin root when the variable is set', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  installed({ '@ahpd/agent-claude': '0.7.0' }, pluginRoot);
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', pluginRoot, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
  ]);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/agent-claude: 0.7.0 to 0.8.0']);
});

it('names the plugin root, not the configuration directory, when a name is not installed there', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  installed({ '@ahpd/agent-claude': '0.8.0' }, pluginRoot);
  const { runner, calls } = fake();
  await expect(updatePlugins(['left-pad'], { configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .rejects.toThrow(`left-pad is not installed in ${pluginRoot}`);
  expect(calls).toEqual([]);
});

it('removes from the plugin root when the variable is set, and configures the daemon itself', async () => {
  const pluginRoot = join(root, 'part', 'ahpd', 'plugins');
  process.env.AHPD_PLUGIN_ROOT = pluginRoot;
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls.map((one) => one.argv)).toEqual([['uninstall', '--prefix', pluginRoot, '--legacy-peer-deps', '--', '@ahpd/a']]);
  expect(read().plugins).toEqual([]);
  expect(said.join('\n')).toContain(pluginRoot);
});

it('asks the registry about every name at once, before any of them answers', async () => {
  const asked: string[] = [];
  let asking = 0;
  let atOnce = 0;
  const { runner, calls } = fake();
  const fetch: Fetch = async (url) => {
    asked.push(String(url).slice(registry().length + 1));
    asking += 1;
    atOnce = Math.max(atOnce, asking);
    // One turn of the event loop, so a registry asked one name at a time
    // answers the first before the second is asked and `atOnce` stays one.
    await new Promise((wait) => setTimeout(wait, 5));
    asking -= 1;
    return Response.json({ ahpd: {} });
  };
  await installPlugins(['one', 'two', 'three'], { configDir, configFile, sdk: '0.8.0', enable: false, run: runner, fetch, say });
  // Each name's own metadata is asked for, and then the manifest of the
  // version it named, which here is `latest` because that answer held none.
  expect(asked).toEqual(['one', 'two', 'three', 'one/latest', 'two/latest', 'three/latest']);
  expect(atOnce).toBe(3);
  expect(calls).toHaveLength(1);
});

it('updates only the packages it is named', async () => {
  installed({
    '@ahpd/agent-acp': '0.8.0',
    '@ahpd/agent-claude': '0.7.0',
    'left-pad': '1.0.0',
  });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins(['@ahpd/agent-claude'], {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0']]);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', '@ahpd/agent-claude: 0.7.0 to 0.8.0']);
});

it('refuses to update a name that is not installed, before npm runs', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner, calls } = fake();
  await expect(updatePlugins(['@ahpd/agent-claude', 'left-pad'], { configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({}) }))
    .rejects.toThrow(`left-pad is not installed in ${configDir}`);
  expect(calls).toEqual([]);
});

it('updates a named plugin beside another on an older minor, with the daemon\'s sdk and no peer check', async () => {
  installed({ '@ahpd/agent-acp': '0.7.0', '@ahpd/agent-claude': '0.7.0', '@ahpd/sdk': '0.7.0' });
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-acp': '0.8.0' });
  expect(await updatePlugins(['@ahpd/agent-acp'], {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-acp': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-acp', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-acp@0.8.0'],
  ]);
  expect(said).toEqual(['Updating @ahpd/agent-acp@0.8.0 with npm.', '@ahpd/agent-acp: 0.7.0 to 0.8.0']);
});

it('moves the sdk with update all without calling it a plugin', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0', '@ahpd/sdk': '0.7.0', 'mine': '1.0.0' });
  writeFileSync(join(configDir, 'package.json'), JSON.stringify({
    dependencies: { '@ahpd/agent-claude': '^0.7.0', '@ahpd/sdk': 'file:../sdk', mine: 'file:../mine' },
  }));
  said.length = 0;
  const { runner, calls } = fake({}, { '@ahpd/agent-claude': '0.8.0' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8' }),
  })).toEqual([{ name: '@ahpd/agent-claude', from: '0.7.0', to: '0.8.0' }]);
  expect(calls.map((one) => one.argv)).toEqual([
    ['install', '--prefix', configDir, '--legacy-peer-deps', '@ahpd/sdk@0.8.0', '@ahpd/agent-claude@0.8.0'],
  ]);
  expect(said).toEqual([
    'mine: file:../mine, left as installed',
    'Updating @ahpd/agent-claude@0.8.0 with npm.',
    '@ahpd/agent-claude: 0.7.0 to 0.8.0',
  ]);
});

it('names the sdk unpinned when the daemon\'s version is unknown', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0' });
  const { runner, calls } = fake();
  await installPlugins(['left-pad'], { configDir, configFile, sdk: 'unknown', enable: false, run: runner, fetch: aPlugin, say });
  await updatePlugins('all', { configDir, sdk: 'unknown', run: runner, say, fetch: registryHolding({}) });
  expect(calls.map((one) => one.argv.slice(3, 5))).toEqual([
    ['--legacy-peer-deps', '@ahpd/sdk'],
    ['--legacy-peer-deps', '@ahpd/sdk'],
  ]);
  // No range can be compared against `unknown`, so nothing is chosen and npm
  // resolves the name itself: an install passes it as written, and an update
  // asks for `latest`.
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['left-pad', '@ahpd/agent-claude@latest']);
});

it('refuses to install or update the sdk by name, before npm runs', async () => {
  installed({ '@ahpd/agent-claude': '0.8.0', '@ahpd/sdk': '0.8.0' });
  const { runner, calls } = fake();
  const refusal = "@ahpd/sdk is not a plugin: ahpd installs it at the version the daemon ships with every install and update.";
  await expect(installPlugins(['@ahpd/sdk'], { configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say })).rejects.toThrow(refusal);
  await expect(installPlugins(['left-pad', '@ahpd/sdk@0.7.0'], { configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch: aPlugin, say })).rejects.toThrow(refusal);
  await expect(updatePlugins(['@ahpd/sdk'], { configDir, sdk: '0.8.0', run: runner, say, fetch: registryHolding({}) })).rejects.toThrow(refusal);
  expect(calls).toEqual([]);
});

it('never uninstalls the sdk', async () => {
  write({ plugins: ['@ahpd/a'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/a', '@ahpd/sdk'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls.map((one) => one.argv)).toEqual([['uninstall', '--prefix', configDir, '--legacy-peer-deps', '--', '@ahpd/a']]);
  calls.length = 0;
  await removePlugins(['@ahpd/sdk'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls).toEqual([]);
});

it('refuses a registry package with no ahpd field before npm runs, asking at the version it would install', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({
    '@ahpd%2fagent-claude': packument(['0.8.0 >=0.8']),
    '@ahpd%2fagent-claude/0.8.0': { name: '@ahpd/agent-claude', version: '0.8.0', ahpd: { entry: './dist/index.js' } },
    '@softov%2fahpc/latest': { name: '@softov/ahpc', version: '0.3.0', bin: { ahpc: './dist/main.js' } },
  });
  await expect(installPlugins(['@ahpd/agent-claude', '@softov/ahpc'], { configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch, say }))
    .rejects.toThrow('@softov/ahpc is not an ahpd plugin: its package.json has no "ahpd" field.');
  expect(calls).toEqual([]);
  expect(asked).toEqual(['@ahpd%2fagent-claude', '@softov%2fahpc', '@softov%2fahpc/latest', '@ahpd%2fagent-claude/0.8.0']);
  expect(existsSync(configFile)).toBe(false);
});

it('installs a package whose manifest has an ahpd field, asked at the version chosen or written', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({
    '@ahpd%2fagent-claude': packument(['0.1.0 >=0.8']),
    '@ahpd%2fagent-claude/0.1.0': { ahpd: { entry: './dist/index.js' } },
    'mine/1.2.0': { ahpd: {} },
    '@acme%2fagent-mine/next': { ahpd: {} },
  });
  await installPlugins(['@ahpd/agent-claude', 'mine@1.2.0', '@acme/agent-mine@next'], { configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch, say });
  expect(asked).toEqual(['@ahpd%2fagent-claude', 'mine/1.2.0', '@acme%2fagent-mine/next', '@ahpd%2fagent-claude/0.1.0']);
  expect(calls).toHaveLength(1);
  // The bare name is installed at the version its own range admits; a version
  // and a tag the writer named go to npm as written.
  expect(calls[0]?.argv.slice(-3)).toEqual(['@ahpd/agent-claude@0.1.0', 'mine@1.2.0', '@acme/agent-mine@next']);
  expect(read().plugins).toEqual(['@ahpd/agent-claude', 'mine', '@acme/agent-mine']);
});

it('never asks the registry about a source, and passes it to npm as written', async () => {
  // `owner/repo` is GitHub's shorthand to npm, and npm resolves it. npm writes
  // it back as a `github:` spec, which is not the text it was given: the one
  // dependency npm added is still the package it landed.
  const { runner, calls } = fake({}, { 'my-plugin': '0.1.0' }, {
    added: { 'my-plugin': 'github:someone/my-plugin' },
    manifests: { 'my-plugin': { ahpd: {} } },
  });
  const { fetch, asked } = fakeRegistry({});
  await installPlugins(['someone/my-plugin'], { configDir, configFile, sdk: '0.8.0', enable: true, run: runner, fetch, say });
  expect(asked).toEqual([]);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['someone/my-plugin']);
  expect(read().plugins).toEqual(['my-plugin']);
});

it('leaves the install to npm when the registry cannot be asked or has no such version', async () => {
  const { runner, calls } = fake();
  const { fetch, asked } = fakeRegistry({ 'offline/latest': new TypeError('fetch failed'), 'missing/latest': 404 });
  await installPlugins(['offline', 'missing'], { configDir, configFile, sdk: '0.8.0', enable: false, run: runner, fetch, say });
  expect(asked).toEqual(['offline', 'missing', 'offline/latest', 'missing/latest']);
  expect(calls.map((one) => one.argv.slice(-2))).toEqual([['offline', 'missing']]);
});

it('says each update from the version on disk before npm to the one on disk after, and nothing for one that did not move', async () => {
  installed({ '@ahpd/agent-acp': '0.8.0', 'left-pad': '0.6.0' });
  said.length = 0;
  const { runner } = fake({}, { 'left-pad': '0.7.1' });
  expect(await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/agent-acp': '0.8.0 >=0.8', 'left-pad': '0.7.1' }),
  })).toEqual([{ name: 'left-pad', from: '0.6.0', to: '0.7.1' }]);
  expect(said).toEqual(['Updating @ahpd/agent-acp@0.8.0 with npm.', 'Updating left-pad@0.7.1 with npm.', 'left-pad: 0.6.0 to 0.7.1']);
});

it('says there was nothing to update when npm moved no version', async () => {
  installed({ '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' });
  said.length = 0;
  const { runner, calls } = fake();
  const fetch = registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8', 'left-pad': '1.3.0' });
  expect(await updatePlugins('all', { configDir, sdk: '0.8.0', run: runner, say, fetch })).toEqual([]);
  expect(calls).toHaveLength(2);
  expect(said).toEqual(['Updating @ahpd/agent-claude@0.8.0 with npm.', 'Updating left-pad@1.3.0 with npm.', 'Nothing to update.']);
  said.length = 0;
  expect(await updatePlugins(['left-pad'], { configDir, sdk: '0.8.0', run: runner, say, fetch })).toEqual([]);
  expect(said).toEqual(['Updating left-pad@1.3.0 with npm.', 'Nothing to update.']);
});

/*
 * The line before npm: npm is silent while it works, so each call follows a
 * line that names what it is given.
 */

/** `fake`, with the lines said so far recorded at each npm call. */
const heard = (answers: Record<string, Ran> = {}, lands: Record<string, string> = {}) => {
  const { runner, calls } = fake(answers, lands);
  const before: string[][] = [];
  const run: Runner = async (program, argv) => {
    before.push([...said]);
    return runner(program, argv);
  };
  return { runner: run, calls, before };
};

it('says the Installing line, with every package named, before npm runs', async () => {
  said.length = 0;
  const { runner, before } = heard();
  await installPlugins(['@ahpd/agent-claude', 'left-pad@1'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
  });
  expect(before).toEqual([['Installing @ahpd/agent-claude@0.1.0, left-pad@1 with npm.']]);
});

it('says one Updating line before each npm call', async () => {
  installed({ '@ahpd/agent-claude': '0.7.0', 'left-pad': '1.0.0' });
  said.length = 0;
  const { runner, before } = heard({}, { '@ahpd/agent-claude': '0.8.0', 'left-pad': '1.3.0' });
  await updatePlugins('all', {
    configDir, sdk: '0.8.0', run: runner, say,
    fetch: registryHolding({ '@ahpd/agent-claude': '0.8.0 >=0.8', 'left-pad': '1.3.0' }),
  });
  expect(before).toEqual([
    ['Updating @ahpd/agent-claude@0.8.0 with npm.'],
    ['Updating @ahpd/agent-claude@0.8.0 with npm.', 'Updating left-pad@1.3.0 with npm.'],
  ]);
});

it('says the Removing line before npm runs', async () => {
  write({ plugins: ['@ahpd/a', '@ahpd/b'] });
  said.length = 0;
  const { runner, before } = heard();
  await removePlugins(['@ahpd/a', '@ahpd/b'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(before).toEqual([[`plugins -= @ahpd/a, @ahpd/b in ${configFile}.`, 'Removing @ahpd/a, @ahpd/b with npm.']]);
});

/*
 * A source a plugin list has takes its version from the list, and npm's
 * result is checked against it.
 */

const OURS = 'https://plugins.example.com/v1/plugins.json';
const THEIRS = 'https://other.example.com/v1/plugins.json';

/** Keep a list for `url` in the configuration folder, as the daemon's fetch would. */
const listed = async (url: string, plugins: ListedPlugin[]): Promise<void> => {
  const fetch: Fetch = async () => Response.json({ version: 1, plugins });
  expect(await refreshMarketplace({ url, version: '0.15.0', dir: configDir, fetch })).toBe('written');
};

/** One listed version with its integrity, or its commit for a git source. */
const listedVersion = (version: string, more: Partial<ListedVersion> = {}): ListedVersion => ({
  version,
  sdk: '>=0.10 <1',
  integrity: `sha512-${version}`,
  files: { download: `https://registry.example.com/${version}.tgz`, manifest: `https://plugins.example.com/${version}/package.json` },
  ...more,
});

/** agent-acp as a list holds it. */
const acp = (versions: ListedVersion[]): ListedPlugin => ({ id: 'agent-acp', source: '@ahpd/agent-acp', versions });

/**
 * The fake runner, which also writes `node_modules/.package-lock.json` after an
 * install as npm does, with the integrity or the resolved URL each package
 * name is given here.
 */
const locking = (locks: Record<string, { integrity?: string; resolved?: string }>, lands: Record<string, string> = {}, added?: Record<string, string>) => {
  const inner = fake({}, lands, added === undefined ? {} : { added });
  const runner: Runner = async (program, argv, options) => {
    const done = await inner.runner(program, argv, options);
    const at = argv.indexOf('--prefix');
    if (argv[0] === 'install' && done.code === 0 && at !== -1) {
      const into = argv[at + 1] as string;
      const packages = Object.fromEntries(Object.entries(locks).map(([name, lock]) => [`node_modules/${name}`, lock]));
      mkdirSync(join(into, 'node_modules'), { recursive: true });
      writeFileSync(join(into, 'node_modules', '.package-lock.json'), JSON.stringify({ packages }));
    }
    return done;
  };
  return { runner, calls: inner.calls };
};

it('installs a listed name at the list\'s version, asks npm nothing first, and keeps its marketplace', async () => {
  write({ plugins: [] });
  await listed(OURS, [acp([listedVersion('0.16.0-rc.1'), listedVersion('0.14.0'), listedVersion('0.13.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-0.14.0' } });
  const registryAsked = fakeRegistry({});
  await installPlugins(['@ahpd/agent-acp'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: registryAsked.fetch, say, marketplaces: [OURS],
  });
  expect(registryAsked.asked).toEqual([]);
  expect(calls[0]?.argv.at(-1)).toBe('@ahpd/agent-acp@0.14.0');
  expect(readInstalled(configDir)).toEqual({ '@ahpd/agent-acp': { marketplace: OURS, source: '@ahpd/agent-acp' } });
});

it('refuses a listed install whose integrity differs, names both values, and leaves no package', async () => {
  write({ plugins: [] });
  await listed(OURS, [acp([listedVersion('0.14.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-other' } });
  await expect(installPlugins(['@ahpd/agent-acp'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: aPlugin, say, marketplaces: [OURS],
  })).rejects.toThrow(`@ahpd/agent-acp 0.14.0 is not the one ${OURS} lists: npm installed integrity sha512-other, the list has sha512-0.14.0.`);
  expect(calls.map((one) => one.argv[0])).toEqual(['install', 'uninstall']);
  expect(read().plugins).toEqual([]);
  expect(readInstalled(configDir)).toEqual({});
});

it('installs from the marketplace named, at that list\'s version', async () => {
  write({ plugins: [] });
  await listed(OURS, [acp([listedVersion('0.14.0')])]);
  await listed(THEIRS, [acp([listedVersion('0.13.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-0.13.0' } });
  await installPlugins(['@ahpd/agent-acp'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: aPlugin, say, marketplaces: [OURS, THEIRS], marketplace: THEIRS,
  });
  expect(calls[0]?.argv.at(-1)).toBe('@ahpd/agent-acp@0.13.0');
  expect(readInstalled(configDir)['@ahpd/agent-acp']?.marketplace).toBe(THEIRS);
});

it('refuses a marketplace pluginMarketplaces does not name, before npm runs', async () => {
  write({ plugins: [] });
  const { runner, calls } = locking({});
  await expect(installPlugins(['@ahpd/agent-acp'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: aPlugin, say, marketplaces: [OURS], marketplace: THEIRS,
  })).rejects.toThrow(`${THEIRS} is not in pluginMarketplaces.`);
  expect(calls).toEqual([]);
});

it('installs a name no list has from npm, as before', async () => {
  write({ plugins: [] });
  await listed(OURS, [acp([listedVersion('0.14.0')])]);
  const { runner, calls } = locking({});
  const registryAsked = fakeRegistry({ 'left-pad': packument(['1.3.0']), 'left-pad/1.3.0': { version: '1.3.0', ahpd: {} } });
  await installPlugins(['left-pad'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: registryAsked.fetch, say, marketplaces: [OURS],
  });
  expect(registryAsked.asked).toEqual(['left-pad', 'left-pad/1.3.0']);
  expect(calls[0]?.argv.at(-1)).toBe('left-pad@1.3.0');
  expect(readInstalled(configDir)).toEqual({});
});

it('installs a listed github: source at its version\'s commit, and checks the commit npm resolved', async () => {
  write({ plugins: [] });
  const git: ListedVersion = { version: '0.8.0', commit: 'abc123', files: { download: 'https://codeload.example.com/abc123', manifest: 'https://plugins.example.com/web/package.json' } };
  await listed(OURS, [{ id: 'web', source: 'github:ahpio/ahpw', versions: [git] }]);
  const { runner, calls } = locking({ web: { resolved: 'git+ssh://git@github.com/ahpio/ahpw.git#abc123' } }, { web: '0.8.0' }, { web: 'github:ahpio/ahpw#abc123' });
  expect(await installPlugins(['github:ahpio/ahpw'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: aPlugin, say, marketplaces: [OURS],
  })).toEqual(['web']);
  expect(calls[0]?.argv.at(-1)).toBe('github:ahpio/ahpw#abc123');
  expect(readInstalled(configDir)).toEqual({ web: { marketplace: OURS, source: 'github:ahpio/ahpw' } });
});

it('refuses a listed github: install whose commit differs', async () => {
  write({ plugins: [] });
  const git: ListedVersion = { version: '0.8.0', commit: 'abc123', files: { download: 'https://codeload.example.com/abc123', manifest: 'https://plugins.example.com/web/package.json' } };
  await listed(OURS, [{ id: 'web', source: 'github:ahpio/ahpw', versions: [git] }]);
  const { runner } = locking({ web: { resolved: 'git+ssh://git@github.com/ahpio/ahpw.git#fff000' } }, { web: '0.8.0' }, { web: 'github:ahpio/ahpw#abc123' });
  await expect(installPlugins(['github:ahpio/ahpw'], {
    configDir, configFile, sdk: '0.15.0', enable: true, run: runner, fetch: aPlugin, say, marketplaces: [OURS],
  })).rejects.toThrow(`web 0.8.0 is not the one ${OURS} lists: npm installed commit fff000, the list has abc123.`);
});

it('puts back the version an update moved from when the list refuses the new one', async () => {
  installed({ '@ahpd/agent-acp': '0.13.0' });
  await listed(OURS, [acp([listedVersion('0.14.0'), listedVersion('0.13.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-other' } }, { '@ahpd/agent-acp': '0.14.0' });
  await expect(updatePlugins('all', {
    configDir, sdk: '0.15.0', run: runner, fetch: aPlugin, say, marketplaces: [OURS],
  })).rejects.toThrow(`@ahpd/agent-acp 0.14.0 is not the one ${OURS} lists`);
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['@ahpd/agent-acp@0.14.0', '@ahpd/agent-acp@0.13.0']);
});

it('updates a listed package to the list\'s version, and keeps its marketplace', async () => {
  installed({ '@ahpd/agent-acp': '0.13.0' });
  await listed(OURS, [acp([listedVersion('0.14.0', { deprecated: 'Broken.' }), listedVersion('0.13.1'), listedVersion('0.13.0')])]);
  const { runner, calls } = locking({ '@ahpd/agent-acp': { integrity: 'sha512-0.13.1' } }, { '@ahpd/agent-acp': '0.13.1' });
  await updatePlugins('all', { configDir, sdk: '0.15.0', run: runner, fetch: aPlugin, say, marketplaces: [OURS] });
  expect(calls.map((one) => one.argv.at(-1))).toEqual(['@ahpd/agent-acp@0.13.1']);
  expect(readInstalled(configDir)['@ahpd/agent-acp']?.marketplace).toBe(OURS);
});

it('forgets the marketplace of a package removed', async () => {
  write({ plugins: ['@ahpd/agent-acp'] });
  recordInstalled(configDir, '@ahpd/agent-acp', { marketplace: OURS, source: '@ahpd/agent-acp' });
  const { runner } = fake();
  await removePlugins(['@ahpd/agent-acp'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(readInstalled(configDir)).toEqual({});
});

it('uninstalls with --legacy-peer-deps, so a plugin in the root whose peer range leaves out the sdk installed does not stop a remove', async () => {
  write({ plugins: ['@ahpd/web'] });
  const { runner, calls } = fake();
  await removePlugins(['@ahpd/web'], { configDir, configFile, uninstall: true, run: runner, say });
  expect(calls[0]?.argv).toContain('--legacy-peer-deps');
});

/*
 * What a manifest asks for is shown before anything is written, and written
 * only when a person consents: `--grant`, or a yes at a terminal. A manifest
 * never grants itself, and an install on a pipe says the command that would.
 */
const asksGrants = { manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: ['probe:read', 'probe:write'] } } } };

it('prints the grants a manifest asks for and writes none without consent', async () => {
  const { runner } = fake({}, {}, asksGrants);
  const lines: string[] = [];
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say: (line) => lines.push(line),
  });
  expect(lines.join('\n')).toContain('@ahpd/probe-grants asks for probe:read, probe:write.');
  expect(lines.join('\n')).toContain('@ahpd/probe-grants: nothing was granted (probe:read, probe:write)');
  expect(read().plugins).toEqual(['@ahpd/probe-grants']);
});

it('writes every grant the manifest asks for with --grant', async () => {
  const { runner } = fake({}, {}, asksGrants);
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say, grant: true,
  });
  expect(read().plugins).toEqual([{ source: '@ahpd/probe-grants', grants: ['probe:read', 'probe:write'] }]);
});

it('writes the grants when a person answers yes at a terminal', async () => {
  const { runner } = fake({}, {}, asksGrants);
  const asked: string[] = [];
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
    confirm: async (question) => { asked.push(question); return true; },
  });
  expect(asked[0]).toContain('probe:read, probe:write');
  expect(read().plugins).toEqual([{ source: '@ahpd/probe-grants', grants: ['probe:read', 'probe:write'] }]);
});

it('leaves an entry without the grants a person refused at a terminal', async () => {
  const { runner } = fake({}, {}, asksGrants);
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
    confirm: async () => false,
  });
  expect(read().plugins).toEqual(['@ahpd/probe-grants']);
});

it('asks nothing and grants nothing when --no-enable writes no entry', async () => {
  const { runner } = fake({}, {}, asksGrants);
  const lines: string[] = [];
  let asked = false;
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say: (line) => lines.push(line),
    confirm: async () => { asked = true; return true; },
  });
  expect(asked).toBe(false);
  expect(lines.join('\n')).toContain('nothing was granted');
  expect(existsSync(configFile)).toBe(false);
});

it('answers a JSON caller what the manifest asked, not only what an entry lacked', async () => {
  // `--no-enable` wrote no entry, so nothing was missing from one; a caller
  // still has to be told what the manifest asked and what a role would need.
  const { runner } = fake({}, {}, {
    manifests: {
      '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: ['probe:read'], callerGrants: ['probe:list'] } },
    },
  });
  const reports: { asked: ReadonlyMap<string, string[]>; declaredCallerGrants: ReadonlyMap<string, string[]>; consented: boolean; granted: boolean }[] = [];
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say,
    report: (facts) => reports.push(facts),
  });
  expect(reports).toHaveLength(1);
  expect([...(reports[0]?.asked.get('@ahpd/probe-grants') ?? [])]).toEqual(['probe:read']);
  expect([...(reports[0]?.declaredCallerGrants.get('@ahpd/probe-grants') ?? [])]).toEqual(['probe:list']);
  expect(reports[0]?.consented).toBe(false);
  expect(reports[0]?.granted).toBe(false);
});

it('refuses --grant with --no-enable by name', async () => {
  const { runner } = fake({}, {}, asksGrants);
  await expect(installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: false, run: runner, fetch: aPlugin, say, grant: true,
  })).rejects.toThrow('--grant writes the grants into the plugin\'s entry, and --no-enable writes no entry');
});

it('prints every grant before it asks for consent', async () => {
  const { runner } = fake({}, {}, asksGrants);
  const lines: string[] = [];
  let printedFirst = false;
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say: (line) => lines.push(line),
    confirm: async (question) => {
      printedFirst = lines.some((one) => one.includes('asks for probe:read, probe:write'));
      expect(question).toContain('probe:read, probe:write');
      return false;
    },
  });
  expect(printedFirst).toBe(true);
});

it('asks only for the grants an existing entry does not already hold', async () => {
  write({ plugins: [{ source: '@ahpd/probe-grants', grants: ['probe:read'] }] });
  const { runner } = fake({}, {}, asksGrants);
  const asked: string[] = [];
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
    confirm: async (question) => { asked.push(question); return true; },
  });
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain('probe:write');
  expect(asked[0]).not.toContain('probe:read');
  expect(read().plugins).toEqual([{ source: '@ahpd/probe-grants', grants: ['probe:read', 'probe:write'] }]);
});

it('asks nothing when the entry already holds every grant the manifest asks for', async () => {
  write({ plugins: [{ source: '@ahpd/probe-grants', grants: ['probe:read', 'probe:write'] }] });
  const { runner } = fake({}, {}, asksGrants);
  const lines: string[] = [];
  let asked = false;
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say: (line) => lines.push(line),
    confirm: async () => { asked = true; return true; },
  });
  expect(asked).toBe(false);
  expect(lines.join('\n')).toContain('already holds every grant its manifest asks for');
});

it('asks nothing for a grant the entry already answers with a wildcard', async () => {
  // `probe:*` is not the word the manifest asks for, and it is what the entry
  // gives: appending `probe:read` beside it would say the entry gained
  // something it already had.
  write({ plugins: [{ source: '@ahpd/probe-grants', grants: ['probe:*'] }] });
  const { runner } = fake({}, {}, asksGrants);
  let asked = false;
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
    confirm: async () => { asked = true; return true; },
  });
  expect(asked).toBe(false);
  expect(read().plugins).toEqual([{ source: '@ahpd/probe-grants', grants: ['probe:*'] }]);
});

it('names each package it grants when several are installed at once', async () => {
  const { runner } = fake({}, {}, {
    manifests: {
      '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: ['probe:read'] } },
      '@ahpd/probe-other': { ahpd: { entry: './index.js', grants: ['other:write'] } },
    },
  });
  const lines: string[] = [];
  await installPlugins(['@ahpd/probe-grants', '@ahpd/probe-other'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say: (line) => lines.push(line), grant: true,
  });
  expect(lines.join('\n')).toContain('@ahpd/probe-grants asks for probe:read.');
  expect(lines.join('\n')).toContain('@ahpd/probe-other asks for other:write.');
  expect(read().plugins).toEqual([
    { source: '@ahpd/probe-grants', grants: ['probe:read'] },
    { source: '@ahpd/probe-other', grants: ['other:write'] },
  ]);
});

it('uninstalls a package whose grants are not a list of grants', async () => {
  const { runner, calls } = fake({}, {}, { manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: 'probe:read' } } } });
  await expect(installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('is not a list of grants');
  expect(calls.some((one) => one.argv[0] === 'uninstall' && one.argv.includes('@ahpd/probe-grants'))).toBe(true);
  expect(existsSync(configFile)).toBe(false);
});

it('says what a plugin asks of the roles that use it', async () => {
  const { runner } = fake({}, {}, {
    manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', callerGrants: ['probe:read', 'probe:write'] } } },
  });
  const lines: string[] = [];
  await installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say: (line) => lines.push(line),
  });
  expect(lines.join('\n')).toContain('Roles that use @ahpd/probe-grants must hold probe:read, probe:write.');
  // The caller list is the surface's, not the entry's: nothing is granted.
  expect(read().plugins).toEqual(['@ahpd/probe-grants']);
});

it('uninstalls a package whose callerGrants are not a list of grants', async () => {
  const { runner, calls } = fake({}, {}, {
    manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', callerGrants: 'probe:read' } } },
  });
  await expect(installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('is not a list of grants');
  expect(calls.some((one) => one.argv[0] === 'uninstall' && one.argv.includes('@ahpd/probe-grants'))).toBe(true);
});

it('uninstalls a package whose grants carry a wildcard', async () => {
  const { runner } = fake({}, {}, { manifests: { '@ahpd/probe-grants': { ahpd: { entry: './index.js', grants: ['probe:*'] } } } });
  await expect(installPlugins(['@ahpd/probe-grants'], {
    configDir, configFile, sdk: '9.9.9', enable: true, run: runner, fetch: aPlugin, say,
  })).rejects.toThrow('which is a wildcard');
});
