/**
 * Installing a plugin, which is one npm call and one edit of `config.json`.
 *
 * A plugin is an installed package: a bare name is resolved from the
 * configuration directory's own `node_modules`, so installing one is `npm
 * install` *there* and enabling it is naming it in `plugins`. This file is the
 * whole of that, kept apart from `main.ts` so the argument list, the version
 * choice and the edit can be tested without a terminal, a registry or a daemon.
 *
 * The configuration file is read and written as the object it is rather than
 * through `loadConfig`, because this is the first thing in this daemon that
 * writes a file a person edits: every other key, the order they were in and
 * the entries this command did not touch have to survive being rewritten.
 *
 * The process boundary is `Runner` and the registry's is `Fetch`, so a test
 * fakes npm and the registry. Nothing here reaches for the clock or the
 * environment: a caller passes the directory, the file and the version to pin
 * to.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { launch, readJsonObject, writeJsonAtomic } from '@ahpd/sdk';
import type { PluginSpec } from '@ahpd/sdk';
import { asSpec } from './config.js';
import { hasScheme, isNamed, sourceOf, pluginIdOf } from './plugins.js';
import { isOffered, newestFitting, type Offered } from './compat.js';
import { fittingListed, forgetInstalled, installedListing, listedVersions, recordInstalled } from './pluginlist.js';
import type { Listing, ListedVersion } from './pluginlist.js';
import { askRegistry, newer, parse, registryPath } from './update.js';
import type { Fetch } from './update.js';

export { launch };
export type { Launch } from '@ahpd/sdk';

/** What one run of a program left behind. */
export interface Ran {
  /** Its exit status, or `-1` when it could not be started. */
  code: number;
  stdout: string;
  stderr: string;
}

/** How a program is run, when the caller needs more than the defaults give. */
export interface RunOptions {
  /**
   * Stop the process after this many milliseconds.
   *
   * `SIGKILL`, so a program that ignores a polite request still goes; a caller
   * that asks for this is one whose output is not worth waiting for.
   */
  timeoutMs?: number;
  /** Keep standard output for the caller rather than passing it on. */
  capture?: boolean;
}

/**
 * How one program is run.
 *
 * Standard input is this process's, so a prompt is the person's to answer.
 * Standard output is this process's standard error, so the command's own stdout
 * stays its payload: `plugin install --json` writes nothing there but its JSON.
 * Standard error is written through as it arrives and kept in full for the
 * caller's reason, because that is where npm explains a failure and a reason
 * read only at the end is one nobody saw while it was happening. The promise
 * settles when the program is gone, so a caller answers whoever it serves
 * meanwhile. Replaced in tests, which is the only reason this is a value at all.
 */
export type Runner = (program: string, argv: readonly string[], options?: RunOptions) => Promise<Ran>;

/** The default runner: the program on PATH, its standard error passed through as it comes. */
export const run: Runner = (program, argv, options = {}) => new Promise((done) => {
  const started = launch(program, argv, process.platform, process.env, process.execPath, existsSync);
  const child = spawn(started.command, started.args, {
    stdio: options.capture === true ? ['ignore', 'pipe', 'pipe'] : ['inherit', 2, 'pipe'],
    shell: started.shell,
    windowsHide: true,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: 'SIGKILL' as const }),
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (answer: Ran): void => {
    if (settled) return;
    settled = true;
    done(answer);
  };
  child.stdout?.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = String(chunk);
    stderr += text;
    if (options.capture !== true) process.stderr.write(text);
  });
  // A program that cannot be started has no words of its own, so the failure
  // to start is what the caller is told.
  child.once('error', (error: Error) => { finish({ code: -1, stdout, stderr: error.message }); });
  child.once('close', (code: number | null) => { finish({ code: code ?? -1, stdout, stderr }); });
});

/**
 * A failed npm call.
 *
 * `message` carries npm's own reason, for a caller that did not see npm run;
 * `failed` is only what failed, for a caller whose terminal the runner has
 * already written npm's error to.
 */
export class NpmFailure extends Error {
  /** What failed, without npm's reason. */
  readonly failed: string;
  constructor(failed: string, reason: string) {
    super(reason === '' ? failed : `${failed}: ${reason}`);
    this.failed = failed;
  }
}

/** The failure of one npm call, with its standard error as the reason, or its exit code when it said nothing. */
export const npmFailed = (failed: string, done: Ran): NpmFailure => {
  const why = done.stderr.trim();
  return new NpmFailure(failed, why === '' ? `exit ${String(done.code)}` : why);
};

/**
 * Whether a spec is a bare package name rather than a path or a scheme.
 *
 * The same test `resolvePlugin` uses to tell a bare name from a path, plus the
 * scheme check. An install takes every source, so this is what tells a
 * registry name - the one kind the registry is asked about before npm runs -
 * from a path, a URL or a git spec, which npm resolves as written.
 */
export const isPackageName = (spec: PluginSpec): boolean => {
  const name = sourceOf(spec);
  return !hasScheme(name) && !isAbsolute(name) && !name.startsWith('.');
};

/**
 * One name as npm should be given it.
 *
 * `@ahpd/sdk` is pinned to the daemon's version, because the daemon is the one
 * that owns the sdk and installs it beside every plugin. Any other name, and a
 * name that already carries a version or a tag, is passed as it was written.
 */
export const pinned = (name: string, daemonVersion: string): string => {
  if (!name.startsWith('@ahpd/') || daemonVersion === 'unknown') return name;
  // A second `@` is the version or tag the writer chose, and scoped names
  // start with one, so the search starts after the first character.
  return name.indexOf('@', 1) === -1 ? `${name}@${daemonVersion}` : name;
};

/** The registry's abbreviated packument: its `dist-tags` and each version's `peerDependencies`. */
const ABBREVIATED = 'application/vnd.npm.install-v1+json';

/** What choosing a version was given. */
export interface VersionOptions {
  /** How the registry is asked; absent, or undefined, is the global `fetch`. */
  fetch?: Fetch | undefined;
  /** The plugin list entry the package is listed in, whose versions are read in place of the registry's. */
  listing?: Listing | undefined;
}

/** A packument's `versions`, or nothing when the answer is not one. */
const versionsIn = (packument: unknown): Record<string, unknown> | undefined => {
  if (typeof packument !== 'object' || packument === null) return undefined;
  const versions = (packument as Record<string, unknown>).versions;
  if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) return undefined;
  return versions as Record<string, unknown>;
};

/** The `dist-tags.latest` a packument names, which is the version the publisher called current. */
const latestIn = (packument: unknown): string | undefined => {
  const tags = typeof packument === 'object' && packument !== null
    ? (packument as Record<string, unknown>)['dist-tags']
    : undefined;
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) return undefined;
  const latest = (tags as Record<string, unknown>).latest;
  return typeof latest === 'string' ? latest : undefined;
};

/** The `@ahpd/sdk` peer range one version declares, or nothing when it declares none. */
const sdkRangeOf = (manifest: unknown): string | undefined => {
  const peers = typeof manifest === 'object' && manifest !== null
    ? (manifest as Record<string, unknown>).peerDependencies
    : undefined;
  if (typeof peers !== 'object' || peers === null || Array.isArray(peers)) return undefined;
  const range = (peers as Record<string, unknown>)[SDK];
  return typeof range === 'string' ? range : undefined;
};

/**
 * The newest version of a registry package that this daemon can load.
 *
 * A plugin is released on its own schedule, so the version it carries says
 * nothing about which daemon it works with; what it declares is
 * `peerDependencies["@ahpd/sdk"]`, the range the loader checks against `sdk`,
 * the sdk the daemon ships, at the next start. The answer is the newest
 * version whose range admits `sdk`, among the versions `offered` admits: a
 * release never above `dist-tags.latest`, because a package published ahead
 * of this daemon is not installed at a version its publisher had not called
 * current, and a prerelease only when `sdk` is one, because a daemon on a
 * release candidate needs the plugins of its own release. Which prerelease is
 * the range's to say.
 *
 * `undefined` is "no version chosen", and the name then goes to npm as written:
 * the registry did not answer, the answer was not a packument, or the sdk's
 * version is `unknown`, which no range can be compared against. When the
 * registry did answer and no version admits the daemon, this refuses, because
 * the loader would refuse such a plugin at the next start.
 *
 * A package in a plugin list is read from its `listing` and not from the
 * registry, by the same rule: the newest listed version is the upper limit in
 * place of `dist-tags.latest`, which a list does not carry, and a version the
 * list marks `deprecated` is never chosen.
 */
export const fittingVersion = async (name: string, sdk: string, options: VersionOptions = {}): Promise<string | undefined> => {
  if (sdk === 'unknown') return undefined;
  if (options.listing !== undefined) return fittingListed(name, options.listing.plugin.versions, sdk)?.version;
  const packument = await askRegistry(registryPath(name), { fetch: options.fetch, accept: ABBREVIATED });
  const versions = versionsIn(packument);
  if (versions === undefined) return undefined;
  const latest = latestIn(packument);
  const offered: Offered[] = [];
  for (const [version, manifest] of Object.entries(versions)) {
    const read = parse(version);
    if (read === undefined || !isOffered(version, sdk)) continue;
    if (!read.prerelease && latest !== undefined && newer(version, latest)) continue;
    offered.push({ version, range: sdkRangeOf(manifest) });
  }
  return newestFitting(name, offered, sdk);
};

/**
 * A spec without the version or tag it was written with.
 *
 * What `plugins` names and what a bare name resolves as: `@ahpd/agent-acp@0.7.0`
 * is installed by npm as `@ahpd/agent-acp`, and the loader asked for the first
 * reports it missing.
 */
export const packageOf = (name: string): string => {
  const at = name.indexOf('@', 1);
  return at === -1 ? name : name.slice(0, at);
};

/** The object a configuration file holds, refusing one that is not an object. */
export const readEntry = (path: string): Record<string, unknown> => {
  const read = readJsonObject(path);
  if (read.ok) return read.value;
  // Not there yet is an entry holding nothing, which is what a first install
  // writes onto.
  if (read.kind === 'missing') return {};
  if (read.kind === 'not-object') throw new Error(`${path} is not a JSON object.`);
  // Both of the other two are the file failing to be read, which is said with
  // what went wrong: text the parser choked on, or the system call's own words.
  throw new Error(`${path} could not be read: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
};

/**
 * Write it back the way every other writer here does.
 *
 * Two-space JSON with a trailing newline, owner-only when it is created,
 * because this is a file that may hold a connection token and the daemon is
 * the one writing it now.
 */
export const writeEntry = (path: string, held: Record<string, unknown>): void => {
  writeJsonAtomic(path, held, { mode: 0o600 });
};

/*
 * The writes, one at a time: an install, an update or a remove starts once the
 * one before it has settled, failure or not, so two served requests never run
 * npm in the same directory together or edit the configuration file between
 * each other's steps. A client's edit of the same file goes here too, for the
 * same reason - two writers each reading the file and then writing it back
 * would lose whichever wrote first.
 */
let settled: Promise<unknown> = Promise.resolve();
export const oneAtATime = <T>(work: () => Promise<T>): Promise<T> => {
  const turn = settled.then(work);
  settled = turn.catch(() => undefined);
  return turn;
};

/** Every name `plugins` already holds, as a spec and as an id, whether an entry is a string or an object. */
const namedIn = (list: unknown): Set<string> => {
  if (!Array.isArray(list)) return new Set();
  const names = new Set<string>();
  for (const entry of list) {
    const spec = asSpec(entry);
    if (spec !== undefined) names.add(sourceOf(spec)).add(pluginIdOf(spec));
  }
  return names;
};

/** Every spec `plugins` holds in the file, for `pluginIdsOf` to name. */
export const specsIn = (path: string): PluginSpec[] => {
  const list = readEntry(path).plugins;
  return Array.isArray(list) ? list.map(asSpec).filter((one): one is PluginSpec => one !== undefined) : [];
};

/**
 * Add each name that is not already in `plugins`, and say which were added.
 *
 * Matched by spec and by id, so naming a package that is configured as an object
 * with options does not replace the options with a bare string. Nothing is
 * written when nothing was added, so a second install of the same package
 * leaves the file's own formatting alone.
 */
export const enableNames = (path: string, names: readonly string[]): string[] => {
  const held = readEntry(path);
  const list = Array.isArray(held.plugins) ? [...held.plugins] : [];
  const already = namedIn(list);
  const added: string[] = [];
  for (const name of names) {
    if (already.has(name)) continue;
    already.add(name);
    list.push(name);
    added.push(name);
  }
  if (added.length === 0) return [];
  held.plugins = list;
  writeEntry(path, held);
  return added;
};

/**
 * Drop every entry whose name matches, string or object, and say which went.
 *
 * Only `plugins` changes: an entry that is not a spec at all is left where it
 * is, because a command whose job is to remove one name is not the place to
 * delete something nobody explained.
 */
export const disableNames = (path: string, names: readonly string[]): string[] => {
  const held = readEntry(path);
  if (!Array.isArray(held.plugins)) return [];
  const wanted = new Set(names);
  const dropped: string[] = [];
  const list = held.plugins.filter((entry) => {
    const spec = asSpec(entry);
    if (spec === undefined) return true;
    const name = [...wanted].find((one) => isNamed(spec, one));
    if (name === undefined) return true;
    dropped.push(name);
    return false;
  });
  if (dropped.length === 0) return [];
  held.plugins = list;
  writeEntry(path, held);
  return dropped;
};

/** The entry `plugins` holds under that id or spec, string or object, or nothing. */
export const pluginEntry = (path: string, name: string): PluginSpec | undefined => {
  const list = readEntry(path).plugins;
  if (!Array.isArray(list)) return undefined;
  for (const entry of list) {
    const spec = asSpec(entry);
    if (spec !== undefined && isNamed(spec, name)) return spec;
  }
  return undefined;
};

/**
 * One entry as the file writes it: `source` names the module, and `name` is
 * what a listing prints.
 *
 * An entry written before `source` named its module with `name`, so that key is
 * dropped and the module it held moves to `source`. Every other key stays as
 * the entry holds it.
 */
export const editableEntry = (spec: PluginSpec, raw: unknown): { source: string; name?: string; options?: Record<string, unknown>; enabled?: boolean } => {
  if (typeof spec === 'string') return { source: spec };
  const held = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const { name: _old, ...rest } = held;
  return {
    ...rest,
    source: sourceOf(spec),
    ...(spec.name === undefined ? {} : { name: spec.name }),
  };
};

/**
 * Rewrite the entry named, as an object, and write the file.
 *
 * Refused naming the plugin when the file does not configure it, because a
 * setting for a plugin that is not loaded is one nobody would see take effect.
 */
const editEntry = (
  path: string,
  name: string,
  change: (entry: { source: string; name?: string; options?: Record<string, unknown>; enabled?: boolean }) => void,
): void => {
  const held = readEntry(path);
  const list = Array.isArray(held.plugins) ? [...held.plugins] : [];
  const at = list.findIndex((entry) => {
    const spec = asSpec(entry);
    return spec !== undefined && isNamed(spec, name);
  });
  if (at === -1) throw new Error(`${name} is not in plugins in ${path}.`);
  const spec = asSpec(list[at]) as PluginSpec;
  const entry = editableEntry(spec, list[at]);
  change(entry);
  list[at] = entry;
  held.plugins = list;
  writeEntry(path, held);
};

/**
 * Set one option of the entry named, or remove it when `value` is undefined,
 * and answer whether the file changed.
 *
 * An entry left with no options loses the key, so an unset leaves no `{}`. An
 * unset of an option the entry does not set leaves the file as it was, a
 * string entry included.
 */
export const setPluginOption = (path: string, name: string, key: string, value: unknown): boolean => {
  if (value === undefined) {
    const spec = pluginEntry(path, name);
    if (spec !== undefined && (typeof spec === 'string' || spec.options === undefined || !Object.hasOwn(spec.options, key))) return false;
  }
  editEntry(path, name, (entry) => {
    const options = { ...entry.options };
    if (value === undefined) delete options[key];
    else options[key] = value;
    if (Object.keys(options).length === 0) delete entry.options;
    else entry.options = options;
  });
  return true;
};

/**
 * Turn the entry named on or off.
 *
 * A string entry is already on, so turning it on leaves the file alone; turning
 * it off makes it an object that says so.
 */
export const setPluginEnabled = (path: string, name: string, enabled: boolean): void => {
  const spec = pluginEntry(path, name);
  if (enabled && typeof spec === 'string') return;
  editEntry(path, name, (entry) => { entry.enabled = enabled; });
};

/**
 * The directory plugins are installed into: `AHPD_PLUGIN_ROOT` when it is set,
 * else the configuration directory.
 *
 * The launcher of the ahpd part sets the variable, where the configuration
 * directory is not writable and a plugin installed there would go nowhere a
 * run would look for it, and the host started on an ssh box from the ahpd
 * installed there is given its install's own root, which holds the plugins
 * pinned with it. Everywhere else it is unset and the configuration directory
 * is the root, which is what the daemon loads a bare name from.
 * An empty value is a variable nobody set, as `rootsOf` reads it.
 */
export const pluginRoot = (configDir: string): string => {
  const root = process.env.AHPD_PLUGIN_ROOT;
  return root === undefined || root === '' ? configDir : root;
};

/** The plugin root's `package.json` `dependencies`, name to spec, in the order it lists them. */
const dependenciesIn = (root: string): [string, string][] => {
  const dependencies = readEntry(join(root, 'package.json')).dependencies;
  if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return [];
  return Object.entries(dependencies as Record<string, unknown>).map(([name, spec]) => [name, String(spec)]);
};

/**
 * Whether a dependency's spec names a package from the npm registry.
 *
 * A path, a `file:` or `link:` spec, a git spec and an http(s) URL are
 * somewhere a person chose, which no registry version replaces.
 */
const fromRegistry = (spec: string): boolean =>
  !/^(?:\.|\/|~|file:|link:|git\+|git:|github:|https?:)/.test(spec);

/** The version of a package installed in the plugin root, or `undefined` when it has none. */
const installedVersion = (root: string, name: string): string | undefined => {
  const path = join(root, 'node_modules', name, 'package.json');
  try {
    const version = readEntry(path).version;
    return typeof version === 'string' ? version : undefined;
  }
  catch {
    return undefined;
  }
};

/** The package every plugin peers, which ahpd installs itself at the daemon's version. */
export const SDK = '@ahpd/sdk';

/** Why `@ahpd/sdk` is refused when it is named to install or update. */
const SDK_IS_NOT_A_PLUGIN = `${SDK} is not a plugin: ahpd installs it at the version the daemon ships with every install and update.`;

/**
 * The packages installed from the registry in the plugin root, in the order
 * the file lists them, `@ahpd/sdk` aside: the ones a daemon update moves.
 *
 * A package from a path, a link, a git or a URL is left as installed, so it is
 * not one an update has a version to check: the person chose what it points at.
 */
export const registryPluginsIn = (root: string): string[] =>
  dependenciesIn(root)
    .filter(([name, spec]) => name !== SDK && fromRegistry(spec))
    .map(([name]) => name);

/**
 * The npm arguments that put `@ahpd/sdk` at the version the daemon ships beside
 * the packages being installed, with no peer checked.
 *
 * Every plugin declares `@ahpd/sdk` as a peer, and the configuration directory
 * is one npm project, so npm would otherwise want one sdk that satisfies every
 * installed plugin: a plugin on one minor would block installing or updating
 * another on the next. Whether a plugin fits is the loader's question, asked
 * of each plugin against the sdk when it loads. `pinned` leaves the sdk
 * unpinned when its version is `unknown`.
 */
const daemonsSdk = (sdk: string): string[] => ['--legacy-peer-deps', pinned(SDK, sdk)];

/** What `plugin install` was given and where it looks. */
export interface InstallOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The configuration file `plugins` is edited in. */
  configFile: string;
  /** The version of the `@ahpd/sdk` the daemon ships, which a plugin's range is checked against and the folder's sdk is pinned to. */
  sdk: string;
  /** Whether to name the packages in `plugins`; false is `--no-enable`. */
  enable: boolean;
  /** How npm is run. */
  run: Runner;
  /** How the registry is asked for a manifest. */
  fetch: Fetch;
  /** One line of this command's own output. */
  say(line: string): void;
  /** The plugin lists a listed source takes its versions from, in order; absent reads none, and npm decides. */
  marketplaces?: readonly string[] | undefined;
  /** The marketplace the sources install from, which `marketplaces` must name; absent takes the first that lists each. */
  marketplace?: string | undefined;
}

/** One source as npm is given it, with the listed version it was chosen as, when a list chose it. */
interface Wanted {
  /** What npm is given. */
  target: string;
  /** The list entry and the version npm is checked against after it runs. */
  listed?: { listing: Listing; version: ListedVersion };
}

/** A package name as the registry has it, which a path, a URL and git's `owner/repo` are not. */
const REGISTRY_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/i;

/**
 * One name per name asked for, as npm should be given it, refusing a registry
 * package whose manifest has no `ahpd` field.
 *
 * A bare registry name has its version chosen by what the package declares it
 * works with: `fittingVersion` reads the registry's own metadata and answers
 * the newest version whose `@ahpd/sdk` peer range admits this daemon. A name
 * that already carries a version or a tag is passed as written, because the
 * writer chose it, and a name the registry cannot be asked for, or one asked
 * for an `unknown` daemon version, goes as written too and npm's own `latest`
 * decides.
 *
 * A plugin with no version that admits this daemon is refused here, before npm
 * runs, so nothing is installed that the loader would refuse at the next start.
 * A registry that does not answer, or has no such version, is npm's to report.
 * Every name is asked at once, so three names are three requests and not one
 * request three times over.
 *
 * A source a plugin list has, an npm name or a `github:` source alike, takes
 * its version from that list (`listedVersions`): a `github:` source is then
 * installed at its version's commit. A listed version is not asked of the
 * registry, since the check after npm reads its manifest, and the version npm
 * installs is checked against the list there. A source no list has installs as
 * it does with no list.
 */
const refuseNonPlugins = async (names: readonly string[], options: InstallOptions): Promise<Wanted[]> => {
  const lists = options.marketplaces === undefined ? undefined : { urls: options.marketplaces, dir: options.configDir, marketplace: options.marketplace };
  return Promise.all(names.map(async (name): Promise<Wanted> => {
    const bare = packageOf(name);
    if (!REGISTRY_NAME.test(bare)) {
      const listing = lists === undefined ? undefined : listedVersions(name, lists);
      if (listing === undefined) return { target: name };
      const version = fittingListed(name, listing.plugin.versions, options.sdk);
      if (version === undefined) return { target: name };
      if (version.commit === undefined) throw new Error(`${name} ${version.version} has no commit in ${listing.marketplace}, so it cannot be installed from that list.`);
      return { target: `${name}#${version.commit}`, listed: { listing, version } };
    }
    const listing = lists === undefined ? undefined : listedVersions(bare, lists);
    const chosen = name === bare ? await fittingVersion(bare, options.sdk, { fetch: options.fetch, listing }) : undefined;
    const target = chosen === undefined ? name : `${bare}@${chosen}`;
    const tag = target === bare ? 'latest' : target.slice(bare.length + 1);
    const version = listing?.plugin.versions.find((one) => one.version === tag);
    if (listing !== undefined && version !== undefined) return { target, listed: { listing, version } };
    const manifest = await askRegistry(`${registryPath(bare)}/${encodeURIComponent(tag)}`, { fetch: options.fetch });
    if (manifest === undefined) return { target };
    if (typeof manifest !== 'object' || manifest === null || !('ahpd' in manifest)) {
      throw new Error(`${bare} is not an ahpd plugin: its package.json has no "ahpd" field.`);
    }
    return { target };
  }));
};

/**
 * What npm installed for one package, as its lock file says: the integrity of
 * a registry package, and the `resolved` URL of a git one.
 */
const lockedIn = (root: string, name: string): { integrity?: string; resolved?: string } => {
  try {
    const packages = readEntry(join(root, 'node_modules', '.package-lock.json')).packages;
    const held = typeof packages === 'object' && packages !== null ? (packages as Record<string, unknown>)[`node_modules/${name}`] : undefined;
    if (typeof held !== 'object' || held === null) return {};
    const { integrity, resolved } = held as Record<string, unknown>;
    return {
      ...(typeof integrity === 'string' ? { integrity } : {}),
      ...(typeof resolved === 'string' ? { resolved } : {}),
    };
  }
  catch {
    return {};
  }
};

/**
 * Why the package npm installed is not the one its list names, or nothing.
 *
 * An npm source is checked by its integrity, and a `github:` source by the
 * commit npm resolved it to. A value npm left no record of is a difference
 * too, since nothing then says the two are the same.
 */
export const listedMismatch = (root: string, name: string, listed: { listing: Listing; version: ListedVersion }): string | undefined => {
  const { listing, version } = listed;
  const locked = lockedIn(root, name);
  const [what, expected, actual] = version.commit !== undefined && version.integrity === undefined
    ? ['commit', version.commit, locked.resolved?.split('#').pop()]
    : ['integrity', version.integrity, locked.integrity];
  if (expected === undefined) return `${name} ${version.version} has no ${what} in ${listing.marketplace}, so it cannot be checked.`;
  if (actual !== undefined && actual.toLowerCase() === expected.toLowerCase()) return undefined;
  return `${name} ${version.version} is not the one ${listing.marketplace} lists: npm installed ${what} ${actual ?? 'none'}, the list has ${expected}.`;
};

/** Whether a source names a package the registry can be asked about, rather than a path, a URL or a git spec. */
const isRegistryName = (source: string): boolean => REGISTRY_NAME.test(packageOf(source));

/** The manifest npm left for `name` in the root, or nothing when it left none. */
const manifestIn = (root: string, name: string): Record<string, unknown> | undefined => {
  const file = join(root, 'node_modules', name, 'package.json');
  return existsSync(file) ? readEntry(file) : undefined;
};

/** The real path of a path, or the path itself where it is not there. */
const realOf = (path: string): string => {
  try { return realpathSync(path); }
  catch { return path; }
};

/**
 * The package name npm wrote for each source, out of the root's dependencies
 * before and after the install.
 *
 * A registry name is its own package, with any version or tag left off. Every
 * other source is named by the dependency npm added for it: npm writes a path
 * as a `file:` spec from the root's real path, to a folder's real path or to a
 * tarball's path as given, and every other kind as it was given. A path and
 * its spec are therefore compared as real paths, so a symbolic link on the way
 * to the root or to the source names the same package. A source npm recorded
 * under a spec this cannot read is the one dependency left over when there is
 * only one, which is how a git shorthand npm rewrites is still named.
 *
 * Nothing here throws: a source with no dependency to name it answers
 * `undefined`, and the caller decides whether that is a refusal (it enables
 * what it installed) or nothing to do (`--no-enable`).
 */
const namesInstalled = (
  sources: readonly string[],
  root: string,
  before: ReadonlyMap<string, string>,
  after: readonly (readonly [string, string])[],
): (string | undefined)[] => {
  const added = after.filter(([name]) => !before.has(name));
  const claimed = new Set<string>();
  const realRoot = realOf(root);
  return sources.map((source) => {
    if (isRegistryName(source)) return packageOf(source);
    // Everything the root names, newly added first: installing a source the
    // root already holds moves no dependency, and it still names the package.
    const open = [...added, ...after.filter(([name]) => before.has(name))].filter(([name]) => !claimed.has(name));
    // A path is resolved against the working directory npm ran in, as npm
    // read it. npm wrote its `file:` spec from the root's real path, so the
    // spec is resolved there, and both ends are compared as real paths:
    // https://github.com/npm/cli/blob/v11.19.0/workspaces/arborist/lib/arborist/build-ideal-tree.js#L524-L565
    const here = realOf(resolve(process.cwd(), source));
    const named = open.find(([, spec]) => spec === source)
      ?? open.find(([, spec]) => spec.startsWith('file:') && realOf(resolve(realRoot, spec.slice('file:'.length))) === here)
      ?? (added.filter(([name]) => !claimed.has(name)).length === 1 ? added.find(([name]) => !claimed.has(name)) : undefined);
    if (named === undefined) return undefined;
    claimed.add(named[0]);
    return named[0];
  });
};

/**
 * Install each source into the plugin root, and answer what npm called them.
 *
 * npm does the install, in the plugin root, because that is the directory a
 * bare name resolves from and a global install is invisible to it. A source
 * starting with `-` is refused before npm runs, because npm would read it as an
 * option rather than a source. A registry package is refused first when its
 * manifest has no `ahpd` field, and a bare name is installed at the newest
 * version that admits this daemon. Every other source - a path, a tarball URL,
 * `github:` or `git+ssh:` - goes to npm as it was written, behind a `--`, and
 * the name it lands under is the dependency npm adds to the root's
 * `package.json`; one that lands with no manifest, or with one that has no
 * `ahpd` field, is uninstalled again and refused. Nothing is loaded here, so
 * whether the plugin works is what the next `ahpd plugin list` or the next run
 * says. What npm is given is said before it runs, because npm says nothing
 * while it works.
 *
 * The answer is the names written into `plugins`, in the order the sources
 * were given: a later command names the row this installed by it.
 *
 * No `--allow-scripts` here, and that is a finding rather than an omission:
 * npm 12 refuses that flag on a project-scoped install (`--prefix`) and tells
 * the caller to put it in the project's `package.json` or `.npmrc` instead.
 * The one native package a config-directory install may reach is the SDK's
 * optional `node-pty`, whose terminal binding the daemon gets from its own
 * global install, where the docs do pass the flag. A plugin with a build
 * script of its own therefore installs its files and skips that script, which
 * npm reports and carries on from.
 */
export async function installPlugins(names: readonly string[], options: InstallOptions): Promise<string[]> {
  for (const name of names) {
    /*
     * npm reads an argument that starts with `-` as an option, whatever it was
     * meant to be, so a source like `--prefix=/x` is refused before npm runs
     * and before anything is written. The `--` in the argv is the second half
     * of that: it holds every source after it to being a source.
     */
    if (name.startsWith('-')) {
      throw new Error(`${name} is not a source to install: a source that starts with "-" would be read by npm as an option.`);
    }
    if (packageOf(name) === SDK) throw new Error(SDK_IS_NOT_A_PLUGIN);
  }
  const asked = await refuseNonPlugins(names, options);
  const wanted = asked.map((one) => one.target);
  const root = pluginRoot(options.configDir);
  // The config dir is made either way: the packages may go elsewhere, but
  // the entry is still written to the daemon's own configuration there.
  mkdirSync(options.configDir, { recursive: true });
  mkdirSync(root, { recursive: true });
  // What the root names before npm runs, so what it added is what npm landed:
  // a source is named by the dependency it became, not by how it was written.
  const before = new Map(dependenciesIn(root));
  options.say(`Installing ${wanted.join(', ')} with npm.`);
  const done = await options.run('npm', ['install', '--prefix', root, ...daemonsSdk(options.sdk), '--', ...wanted]);
  if (done.code !== 0) {
    throw npmFailed(`npm could not install ${names.join(', ')}`, done);
  }
  const installed = namesInstalled(names, root, before, dependenciesIn(root));
  const packages: string[] = [];
  for (const [at, name] of installed.entries()) {
    if (name === undefined) {
      // npm succeeded and wrote no dependency to name the source by, so there
      // is nothing this can write into `plugins`. With `--no-enable` there is
      // nothing to write anyway, and the install stands as npm left it.
      if (!options.enable) continue;
      throw new Error(`${names[at] as string} was installed, but npm wrote no dependency for it into ${join(root, 'package.json')}.`);
    }
    /*
     * A package with no manifest where npm should have put one is not a plugin
     * either: npm may land a source that resolves to nothing, or a manifest it
     * could not read, and either way there is nothing for the loader to check.
     */
    const manifest = manifestIn(root, name);
    if (manifest === undefined || !('ahpd' in manifest)) {
      const undone = await options.run('npm', ['uninstall', '--prefix', root, '--legacy-peer-deps', '--', name]);
      if (undone.code !== 0) throw npmFailed(`npm could not uninstall ${name}, which is not an ahpd plugin`, undone);
      throw new Error(`${name} is not an ahpd plugin: its package.json has no "ahpd" field.`);
    }
    // A version a list chose is the one the list names, or it is not kept.
    const listed = asked[at]?.listed;
    const differs = listed === undefined ? undefined : listedMismatch(root, name, listed);
    if (differs !== undefined) {
      const undone = await options.run('npm', ['uninstall', '--prefix', root, '--legacy-peer-deps', '--', name]);
      if (undone.code !== 0) throw npmFailed(`npm could not uninstall ${name}, which is not the version its list names`, undone);
      throw new Error(differs);
    }
    if (listed !== undefined) recordInstalled(options.configDir, name, { marketplace: listed.listing.marketplace, source: listed.listing.plugin.source });
    packages.push(name);
  }
  options.say(`Installed ${wanted.join(', ')} into ${root}.`);
  if (!options.enable) {
    options.say('--no-enable, so the configuration was not changed.');
    return packages;
  }
  const added = enableNames(options.configFile, packages);
  options.say(added.length === 0
    ? `${options.configFile} already names ${packages.join(', ')}.`
    : `plugins += ${added.join(', ')} in ${options.configFile}.`);
  return packages;
}

/** What `plugin update` was given and where it looks. */
export interface UpdateOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The version of the `@ahpd/sdk` the daemon ships, which each plugin's range is checked against and the folder's sdk is pinned to. */
  sdk: string;
  /** How npm is run. */
  run: Runner;
  /** How the registry is asked which version of a package this daemon can load. */
  fetch: Fetch;
  /** One line of this command's own output. */
  say(line: string): void;
  /** The plugin lists a listed package takes its versions from, in order; absent reads none, and npm decides. */
  marketplaces?: readonly string[] | undefined;
}

/** A package `plugin update` moved, with its version on disk before and after npm; absent is not installed. */
export interface Moved {
  name: string;
  from?: string;
  to?: string;
}

/** The packages an `updatePlugins` that threw had moved before it did, or none for any other error. */
export const movedBefore = (error: unknown): Moved[] => {
  const moved = (error as { moved?: unknown } | null)?.moved;
  return Array.isArray(moved) ? moved as Moved[] : [];
};

/**
 * Move the packages installed in the plugin root, each in an npm call of its
 * own: every one for `all`, or only those named, each of which must be
 * installed there.
 *
 * Each package goes to the newest of its own versions whose `@ahpd/sdk` range
 * admits this daemon, `@ahpd/*` or not, or to `latest` when the registry cannot
 * be asked; a name that carries a version or a tag is passed as written. A
 * package with no version that admits this daemon cannot be installed at all,
 * so it is said and left where it is while the others move. A package
 * installed from outside the registry is left as it is. `config.json` is not
 * touched. Says what each npm call is given before it runs, then each package
 * whose installed version changed, from the version before npm to the one npm
 * left, or `Nothing to update.` when none did, and answers those packages. The
 * sdk is installed beside them by every call, so a version of it that changed
 * is answered as moved too, though it is no plugin to name.
 *
 * Every package is attempted and answered on its own, as VS Code's update of
 * every extension asks each for its compatible version and answers each, one
 * that has none or fails taking no other with it
 * (src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts
 * L2088-L2105, src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts
 * L193-L215 at 6b68d3fe): what moved is said, and the ones npm refused end the
 * command together, with npm's words for the first. That error carries the
 * packages that did move, which `movedBefore` reads.
 */
export async function updatePlugins(names: 'all' | readonly string[], options: UpdateOptions): Promise<Moved[]> {
  const root = pluginRoot(options.configDir);
  const dependencies = dependenciesIn(root);
  const specs = new Map(dependencies);
  if (names !== 'all') {
    for (const name of names) {
      if (packageOf(name) === SDK) throw new Error(SDK_IS_NOT_A_PLUGIN);
      if (!specs.has(packageOf(name))) throw new Error(`${packageOf(name)} is not installed in ${root}.`);
    }
  }
  // The sdk is in `dependencies` because ahpd installs it, and moves with every
  // call below; it is not a plugin to move or to name.
  const asked = names === 'all' ? dependencies.map(([name]) => name).filter((name) => name !== SDK) : names;
  if (asked.length === 0) {
    options.say(`No plugin is installed in ${root}.`);
    return [];
  }
  const moving: string[] = [];
  for (const name of asked) {
    const spec = specs.get(packageOf(name)) ?? '';
    if (fromRegistry(spec)) moving.push(name);
    else options.say(`${packageOf(name)}: ${spec}, left as installed`);
  }
  if (moving.length === 0) {
    options.say('Nothing to update.');
    return [];
  }
  /*
   * What each package moving is asked of npm, the registry asked about all of
   * them at once. A package whose registry holds no version this daemon can
   * load has nothing to be installed at, and is said in the same words an
   * install refuses it with.
   */
  type Planned = { name: string; target: string; listed?: { listing: Listing; version: ListedVersion } } | { name: string; why: string };
  const planned = await Promise.all(moving.map(async (name): Promise<Planned> => {
    if (name !== packageOf(name)) return { name, target: name };
    try {
      // The list the package was installed from, or the first that lists it.
      const listing = options.marketplaces === undefined ? undefined : installedListing(name, { urls: options.marketplaces, dir: options.configDir });
      const version = await fittingVersion(name, options.sdk, { fetch: options.fetch, listing });
      const listed = listing?.plugin.versions.find((one) => one.version === version);
      return {
        name,
        target: version === undefined ? `${name}@latest` : `${name}@${version}`,
        ...(listing === undefined || listed === undefined ? {} : { listed: { listing, version: listed } }),
      };
    }
    catch (error) {
      return { name, why: error instanceof Error ? error.message : String(error) };
    }
  }));
  for (const one of planned) {
    if ('why' in one) options.say(one.why);
  }
  const kept = planned.filter((one): one is Exclude<Planned, { why: string }> => 'target' in one);
  if (kept.length === 0) {
    options.say('Nothing to update.');
    return [];
  }
  const from = kept.map((one) => installedVersion(root, packageOf(one.name)));
  const sdkFrom = installedVersion(root, SDK);
  const refused: string[] = [];
  let reason: Ran | undefined;
  /** What a list refused after npm ran, one sentence for each package put back. */
  const differed: string[] = [];
  for (const [at, one] of kept.entries()) {
    options.say(`Updating ${one.target} with npm.`);
    const done = await options.run('npm', ['install', '--prefix', root, ...daemonsSdk(options.sdk), one.target]);
    if (done.code === 0) {
      const name = packageOf(one.name);
      const differs = one.listed === undefined ? undefined : listedMismatch(root, name, one.listed);
      if (differs === undefined) {
        if (one.listed !== undefined) recordInstalled(options.configDir, name, { marketplace: one.listed.listing.marketplace, source: one.listed.listing.plugin.source });
        continue;
      }
      // The version the package moved from goes back, so a list that refuses
      // a version leaves the plugin as it was and not uninstalled.
      const before = from[at];
      const back = before === undefined
        ? await options.run('npm', ['uninstall', '--prefix', root, '--legacy-peer-deps', '--', name])
        : await options.run('npm', ['install', '--prefix', root, ...daemonsSdk(options.sdk), `${name}@${before}`]);
      differed.push(back.code === 0 ? differs : `${differs} npm could not put ${name} back as it was.`);
      continue;
    }
    // Which package npm refused, and npm's own words for the first of them.
    reason ??= done;
    refused.push(packageOf(one.name));
  }
  const moved: Moved[] = [];
  kept.forEach((one, at) => {
    const to = installedVersion(root, packageOf(one.name));
    if (to === from[at]) return;
    moved.push({ name: packageOf(one.name), ...(from[at] === undefined ? {} : { from: from[at] }), ...(to === undefined ? {} : { to }) });
    options.say(`${packageOf(one.name)}: ${from[at] ?? 'not installed'} to ${to ?? 'not installed'}`);
  });
  const sdkTo = installedVersion(root, SDK);
  if (sdkTo !== sdkFrom) {
    moved.push({ name: SDK, ...(sdkFrom === undefined ? {} : { from: sdkFrom }), ...(sdkTo === undefined ? {} : { to: sdkTo }) });
    options.say(`${SDK}: ${sdkFrom ?? 'not installed'} to ${sdkTo ?? 'not installed'}`);
  }
  // "Nothing to update." is left unsaid when npm refused some, because the
  // refusal that follows says why nothing did.
  if (moved.length === 0 && reason === undefined && differed.length === 0) options.say('Nothing to update.');
  if (reason !== undefined) throw Object.assign(npmFailed(`npm could not update ${refused.join(', ')}`, reason), { moved });
  if (differed.length > 0) throw Object.assign(new Error(differed.join(' ')), { moved });
  return moved;
}

/** What `plugin remove` was given and where it looks. */
export interface RemoveOptions {
  /** The configuration directory, which is the plugin root when `AHPD_PLUGIN_ROOT` is unset. */
  configDir: string;
  /** The configuration file `plugins` is edited in. */
  configFile: string;
  /** Whether to uninstall the packages; false is `--keep`. */
  uninstall: boolean;
  /** How npm is run. */
  run: Runner;
  /** One line of this command's own output. */
  say(line: string): void;
}

/**
 * Take each name out of `plugins`, and uninstall it unless asked not to.
 *
 * The configuration is edited first, so a `remove --keep` that only wanted the
 * run to stop loading a plugin leaves the package where it is. An uninstall
 * that fails is reported after the list has already changed, which is the
 * order a person can act on: the plugin is off, and npm's reason is on screen.
 * The packages are said before npm runs.
 */
export async function removePlugins(names: readonly string[], options: RemoveOptions): Promise<void> {
  for (const name of names) {
    // As in `installPlugins`: npm reads an argument that starts with `-` as an option.
    if (name.startsWith('-')) {
      throw new Error(`${name} is not a plugin to remove: a name that starts with "-" would be read by npm as an option.`);
    }
  }
  const root = pluginRoot(options.configDir);
  const packages = names.map(packageOf);
  const dropped = disableNames(options.configFile, packages);
  options.say(dropped.length === 0
    ? `${options.configFile} did not name ${packages.join(', ')}.`
    : `plugins -= ${dropped.join(', ')} in ${options.configFile}.`);
  if (!options.uninstall) return;
  // The sdk is the daemon's, installed beside every plugin, and stays.
  const uninstalled = packages.filter((name) => name !== SDK);
  if (uninstalled.length === 0) return;
  options.say(`Removing ${uninstalled.join(', ')} with npm.`);
  const done = await options.run('npm', ['uninstall', '--prefix', root, '--legacy-peer-deps', '--', ...uninstalled]);
  if (done.code !== 0) {
    throw npmFailed(`npm could not uninstall ${uninstalled.join(', ')}`, done);
  }
  forgetInstalled(options.configDir, uninstalled);
  options.say(`Uninstalled ${uninstalled.join(', ')} from ${root}.`);
}
