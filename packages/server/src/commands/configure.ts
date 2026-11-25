/**
 * `ahpd configure`: ask, at the terminal, for each setting a first install needs.
 *
 * A fresh install refuses to start with no backend and no folder, naming an
 * `ahpd plugin install` a person has to know about; this is the other way in.
 * Every question shows the value the file holds now, so a second run edits what
 * is there rather than overwriting it with defaults somebody has changed, and
 * every key this command was not asked about is left where it was.
 *
 * The questions are the ones a first run cannot do without: which backends, the
 * address and the port, the token, and the folders whose sessions this host
 * serves. Anything else is a key somebody who knows the daemon is already
 * looking for, and asking about it here would put a question in front of
 * everybody for a setting almost nobody sets.
 *
 * Terminal only, and never served: a question has no answer over HTTP, and a
 * deployment has no person to give it one. `ask` refuses without a terminal, so
 * this is where a script that pipes a line in is told why it is not going to be
 * asked anything.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { styleText } from 'node:util';
import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { filePolicies, installLine, isRecord, knownAgents, sdkVersion } from '@ahpd/sdk';
import type { Policy, PolicyKind, RecordCollection } from '@ahpd/sdk';
import { ask, answering, confirm, here, multiselect, report, type Term } from '../ask.js';
import { asSpec, besideFile, configDir, configPath, policiesPath } from '../config.js';
import { marketplacesOf } from '../pluginlist.js';
import { AGENT_PLUGIN, agentLines, alsoLines, configuredAgents, findAgents, findAlso, findRuntimes, missingLines, runtimeLines } from '../found.js';
import { editableEntry, installPlugins, readEntry, run as runProgram, writeEntry, type Runner } from '../install.js';
import { isNamed, sourceOf, pluginIdOf } from '../plugins.js';
import { fileRecords } from '../records.js';
import type { Fetch } from '../update.js';
import { serverFields, stop, type Options } from './options.js';
import { usersAt } from './user.js';

/**
 * The backends this daemon can be given, and the package each is.
 *
 * These are the native backends, which each run an agent in this process. The
 * ACP agents are not here: they all run through `@ahpd/agent-acp`, and
 * `configure` offers each one whose command it finds on PATH. The order is the
 * one a person is most likely to want them in.
 */
/** The ACP runtime, which runs the ACP agents found on this machine. */
const ACP = '@ahpd/agent-acp';

const BACKENDS: readonly { name: string; package: string; hint: string }[] = [
  { name: 'ACP', package: ACP, hint: 'Codex, Gemini, Copilot and the other ACP agents found on this machine' },
  { name: 'Claude', package: '@ahpd/agent-claude', hint: 'Claude Code through the Claude Agent SDK' },
  { name: 'cofold', package: '@ahpd/agent-cofold', hint: 'cofold, the agent framework this project builds' },
  { name: 'pi', package: '@ahpd/agent-pi', hint: 'the pi agent, run in this process' },
];

/** The one a first install gets without being asked, because a daemon needs a backend. */
const FIRST = '@ahpd/agent-claude';

/**
 * The native pi backend.
 *
 * The ACP agent `pi` serves the same name, so a host with both is one where one
 * of the two is dropped at the next start.
 */
const PI = '@ahpd/agent-pi';

/**
 * The plugins that are neither a backend nor an ACP agent.
 *
 * A backend runs an agent in this process, which is what a daemon needs. These
 * are asked with the same question and installed the same way, and a daemon
 * with none of them still starts.
 */
const OTHERS: readonly { name: string; package: string; hint: string }[] = [
  { name: 'Web UI', package: '@ahpd/web', hint: 'the web interface for ahpd' },
  { name: 'Tasks', package: '@ahpd/tasks', hint: 'tasks and plans that agents coordinate through' },
  { name: 'Computers', package: '@ahpd/computer', hint: 'sessions in isolated machines: containers, VMs or ssh' },
  { name: 'Push', package: '@ahpd/push', hint: 'a notification when a session needs you' },
  { name: 'Bots', package: '@ahpd/bot', hint: 'agents with a name, a persona and a workspace of their own' },
  { name: 'Webhooks', package: '@ahpd/webhook', hint: 'external services trigger actions, each with its own secret' },
  { name: 'Dev Tunnels', package: '@ahpd/tunnel-devtunnel', hint: 'reach this daemon from anywhere, without opening ports' },
  { name: 'Activepieces', package: '@ahpd/activepieces', hint: 'Activepieces pieces as connectors and their actions as tools' },
] as const;

/** The users file a run that adds a person writes, beside the configuration, when the configuration names none. */
const USERS = 'users.json';

/**
 * The role Enter gives a person added here.
 *
 * The one built-in role that can start a session: `guest` only reads, and
 * `admin` holds `*:*`, which no policy is ever checked against.
 */
const ROLE = 'member';

/** The kinds a starter row is offered for, which are the kinds a person's work is checked for. */
const STARTER_KINDS: readonly PolicyKind[] = ['agent', 'computer', 'model'];

/**
 * Whether a row lets every person use everything of its kind: an active allow
 * of scope `all` whose match names `*` for the kind's own value type. A kind
 * with none refuses every person whom no narrower row covers.
 */
const coversAll = (row: Policy, kind: PolicyKind): boolean => row.kind === kind && row.effect === 'allow'
  && row.scope === 'all' && row.from === undefined && row.until === undefined
  && (row.match[kind]?.includes('*') ?? false);

/** The file the token is written to, beside the configuration that names it. */
const TOKEN = 'connection-token';

/** What `ahpd configure` was given, and where it writes. */
export interface ConfigureOptions {
  /** The configuration directory npm installs into. */
  configDir: string;
  /** The configuration file this reads, asks against and writes. */
  configFile: string;
  /** The version of the `@ahpd/sdk` the daemon ships, which a plugin's range is checked against, and which the sdk is installed at. */
  sdk: string;
  /** The terminal the questions are asked on. */
  term: Term;
  /** How npm is run. */
  run: Runner;
  /** The PATH text the runtimes and agents are looked up on. Defaults to this process's own. */
  path?: string;
  /** How the registry is asked whether a package is a plugin. */
  fetch: Fetch;
  /** One line of this command's own output. */
  say(line: string): void;
}

/** What a run of `configure` left behind, which is what the command answers with. */
export interface Configured {
  /** The file it wrote. */
  path: string;
  /** The backends this run was given, installed or already named. */
  backends: string[];
  /** The folders this host will serve. */
  paths: string[];
  /** The people this run added to the users file, by id. */
  added: string[];
}

/** Every name `plugins` already holds, as a spec and as an id, whether an entry is a string or an object. */
const named = (held: Record<string, unknown>): Set<string> => {
  const names = new Set<string>();
  if (!Array.isArray(held.plugins)) return names;
  for (const entry of held.plugins) {
    const spec = asSpec(entry);
    if (spec !== undefined) names.add(sourceOf(spec)).add(pluginIdOf(spec));
  }
  return names;
};

/** The folders the file holds, or the one this daemon would serve with none. */
const foldersIn = (held: Record<string, unknown>): string[] => {
  if (!Array.isArray(held.paths)) return [process.cwd()];
  const folders = held.paths.filter((one): one is string => typeof one === 'string');
  return folders.length === 0 ? [process.cwd()] : folders;
};

/** What is in the token file, or nothing when there is none or it is empty. */
const heldToken = (path: string): string | undefined => {
  if (!existsSync(path)) return undefined;
  const held = readFileSync(path, 'utf8').trim();
  return held === '' ? undefined : held;
};

/**
 * The entry named, switched on or off, as `ahpd plugin disable` writes it.
 *
 * A string entry is already on, so switching it on leaves the string it was.
 */
const switched = (list: unknown[], name: string, enabled: boolean): unknown[] => list.map((entry) => {
  const spec = asSpec(entry);
  if (spec === undefined || !isNamed(spec, name)) return entry;
  if (enabled && typeof spec === 'string') return entry;
  const at = typeof spec === 'string' ? { source: spec } : editableEntry(spec, entry);
  return { ...at, enabled };
});

/** Whether the file names this plugin and does not switch it off. */
const enabledIn = (list: unknown[], name: string): boolean => {
  for (const entry of list) {
    const spec = asSpec(entry);
    if (spec === undefined || !isNamed(spec, name)) continue;
    return typeof spec === 'string' || spec.enabled !== false;
  }
  return false;
};

/**
 * The plugin list with the plugin every ACP agent runs through named in it.
 *
 * The record is what serves the agent, and the package is what registers the
 * engine the record runs on, so taking an agent without the package would leave a
 * record nobody can open. An entry already there is left as it is, whichever
 * way it was written and whether or not it is switched off.
 */
const withAgentPlugin = (list: unknown[]): unknown[] => {
  const present = list.some((entry) => {
    const spec = asSpec(entry);
    return spec !== undefined && isNamed(spec, AGENT_PLUGIN);
  });
  return present ? list : [...list, AGENT_PLUGIN];
};

/** One agent taken here, written as the host record the agents channel serves. */
const takeAgent = async (agents: RecordCollection, id: string): Promise<void> => {
  if (await agents.get(id) !== undefined) return;
  await agents.put({
    id,
    engine: 'acp',
    // The host owned the agents a preset registered, and it owns the records
    // they become: a record with no readable owner is served to nobody.
    owner: 'host',
    name: knownAgents[id]?.name ?? id,
    config: {},
  });
};

/** The agent record of one id taken out, when it is one an ACP agent runs as. */
const dropAgent = async (agents: RecordCollection, id: string): Promise<boolean> => {
  const held = await agents.get(id);
  if (held === undefined || held['engine'] !== 'acp') return false;
  return agents.remove(id);
};

/**
 * The `@ahpd/agent-acp` entry with a preset the file still holds taken out.
 *
 * A file written before records is moved at the next start, and until then its
 * presets are the only copy of its agents. This drops one from the file as
 * well, so the agent does not come back with the next migration. A file with no
 * such entry, a string one, or one that does not name the preset is left as it
 * is.
 */
const withoutPreset = (list: unknown[], id: string): unknown[] => {
  const at = list.findIndex((entry) => {
    const spec = asSpec(entry);
    return spec !== undefined && isNamed(spec, AGENT_PLUGIN);
  });
  if (at === -1) return list;
  const spec = asSpec(list[at]);
  if (spec === undefined || typeof spec === 'string') return list;
  const entry: Record<string, unknown> = { ...editableEntry(spec, list[at]) };
  const options = isRecord(entry.options) ? entry.options : {};
  const presets = isRecord(options['presets']) ? options['presets'] : {};
  if (!Object.hasOwn(presets, id)) return list;
  const rest = Object.fromEntries(Object.entries(presets).filter(([key]) => key !== id));
  const next = [...list];
  next[at] = { ...entry, options: { ...options, presets: rest } };
  return next;
};

/**
 * Ask every question, write the file, and install what was asked for.
 *
 * The file is written before npm runs, because a plugin that will not install is
 * a reason to keep the settings somebody just chose, and `enableNames` then adds
 * the packages npm installed to what is already there.
 */
/**
 * Ask whether a listener is served, and on which port when it is.
 *
 * The answer is `undefined` when the file holds nothing and the answer is No,
 * so an absent key stays absent; otherwise it is `false`, `true` for the
 * daemon's own listener, or `{ port }` for a listener of its own.
 */
const listenerQuestion = async (
  name: string,
  was: unknown,
  term: Term,
  configFile: string,
): Promise<boolean | { port: number } | undefined> => {
  const on = was !== undefined && was !== false;
  if (!await confirm(`Serve the ${name}?`, on, term)) return was === undefined ? undefined : false;
  const current = typeof was === 'object' && was !== null && 'port' in was && typeof (was as { port: unknown }).port === 'number'
    ? String((was as { port: number }).port)
    : 'own';
  const typed = (await ask(`Port for the ${name}, or own for the daemon's own listener`, current, term)).trim();
  if (typed === 'own') return true;
  const port = Number(typed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    stop(`The ${name} port must be a number from 1 to 65535, not ${typed}, in ${configFile}.`);
  }
  return { port };
};

/**
 * Run one install line through the platform's shell, as a person would type it.
 *
 * The line is a vendor's command, so it is run by the shell that reads it and
 * is never split here.
 */
const runShell = (run: Runner, platform: NodeJS.Platform, line: string) => (platform === 'win32'
  ? run('cmd.exe', ['/d', '/s', '/c', line])
  : run('/bin/sh', ['-c', line]));

export async function configure(options: ConfigureOptions): Promise<Configured> {
  const held = readEntry(options.configFile);
  const installed = named(held);
  /*
   * The agent records, which is where an agent taken here is written.
   *
   * The same folder and format the daemon opens at its start, so the agent is
   * one the next start serves rather than a preset it has to move first.
   */
  const agentRecords = await fileRecords(options.configDir).collection('agents', { format: 'json' });
  // A file that is not there yet is the run that offers what a first install
  // wants; a later run asks with the file's own answer in front of the person.
  const firstRun = !existsSync(options.configFile);

  /*
   * The backends, one question each.
   *
   * Enter keeps a backend the file already names, and takes Claude on a first
   * run because a daemon with no backend refuses to start. A No on one the file
   * already names switches it off rather than taking it out, the way
   * `ahpd plugin disable` writes it and with the options it was given left
   * where they are: removing a plugin is `ahpd plugin remove`, and meaning the
   * same thing here would mean uninstalling it too.
   */
  const platform = process.platform;
  const path = options.path ?? process.env.PATH ?? '';
  const onPath = held.onPath === 'findExecutable' ? 'findExecutable' : 'runnable';
  const runtimes = await findRuntimes({ run: options.run, path, platform, onPath });
  const configured = configuredAgents(held.plugins, await agentRecords.list());
  const found = await findAgents({ run: options.run, path, platform, onPath }, configured);
  // The runtimes are said before the questions. The agents are said once ACP is
  // answered on, since they are only listed for ACP to run.
  for (const line of runtimeLines(runtimes)) options.say(line);
  let plugins = Array.isArray(held.plugins) ? [...held.plugins] : [];
  // Claude and ACP are on by default, as a daemon with neither is not much use:
  // ACP runs the agents found below, and a daemon with no backend will not start.
  const backendNow = BACKENDS.filter((backend) => installed.has(backend.package)
    || backend.package === FIRST || backend.package === ACP);
  const backends = await multiselect(
    'Which agent runtimes should ahpd run?',
    BACKENDS.map((backend) => ({ value: backend.package, label: backend.name, hint: backend.hint })),
    backendNow.map((backend) => backend.package),
    options.term,
  );
  for (const backend of BACKENDS) {
    const was = installed.has(backend.package);
    if (was && enabledIn(plugins, backend.package) !== backends.includes(backend.package)) {
      plugins = switched(plugins, backend.package, backends.includes(backend.package));
    }
  }
  const nativePi = backends.includes(PI);

  /*
   * The other plugins, asked with the same question as a backend.
   *
   * Enter takes one on a first run, because a first install is the one that
   * gets what the daemon offers without being asked. A later run shows the
   * file's own answer, so a plugin somebody switched off is not reinstalled
   * by pressing Enter through the questions.
   */
  const others = await multiselect(
    'Which other plugins should ahpd install?',
    OTHERS.map((other) => ({ value: other.package, label: other.name, hint: other.hint })),
    OTHERS.filter((other) => enabledIn(plugins, other.package) || firstRun).map((other) => other.package),
    options.term,
  );
  for (const other of OTHERS) {
    const was = installed.has(other.package);
    if (was && enabledIn(plugins, other.package) !== others.includes(other.package)) {
      plugins = switched(plugins, other.package, others.includes(other.package));
    }
  }

  /*
   * What this machine has, and the agents on it.
   *
   * The lines come before the questions that follow, so a person reads which
   * runtime ahpd will use and which agent commands are there before deciding
   * anything. An agent that is not installed is not a question: it is listed
   * after the questions with the vendor's line for this system, and nothing
   * more is said about it. A found agent this host already has a record for is
   * shown as configured and not asked about again.
   */
  const taken: string[] = [];
  for (const line of alsoLines(await findAlso({ run: options.run, path, platform, onPath }))) options.say(line);
  // The agents are asked for only when ACP is on, since ACP is what runs them.
  if (answering(options.term) && backends.includes(ACP)) {
    for (const line of agentLines(found.agents)) options.say(line);
    /*
     * The native backend and the ACP agent `pi` serve the same name, and the
     * daemon keeps only the first. Taking the native one is taken to mean the
     * ACP one, so it is not offered, and a person who wants the ACP agent
     * unticks the native backend instead.
     */
    const offered = found.agents.filter((one) => {
      if (nativePi && one.agent.id === 'pi') {
        options.say(`${one.agent.command}: not asked, the pi backend runs pi`);
        return false;
      }
      return !one.configured;
    });
    const kept = offered.length === 0 ? [] : await multiselect(
      'Which agents found on this machine should ahpd serve?',
      offered.map((one) => ({ value: one.agent.id, label: one.agent.name })),
      offered.map((one) => one.agent.id),
      options.term,
    );
    for (const one of offered) {
      if (!kept.includes(one.agent.id)) continue;
      taken.push(one.agent.id);
      plugins = withAgentPlugin(plugins);
      try {
        await takeAgent(agentRecords, one.agent.id);
      }
      catch (error) {
        stop(`The agent ${one.agent.id} could not be written as a record: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    /*
     * The agents this machine does not have, each with its install line for
     * this system. Nothing is installed unless it is ticked here and a second
     * question says yes, so a list of commands is never run by Enter.
     */
    const absent = found.missing.filter((agent) => installLine(agent, platform) !== undefined);
    const toInstall = absent.length === 0 ? [] : await multiselect(
      'Which ACP agents not found here should ahpd install?',
      absent.map((agent) => ({ value: agent.id, label: agent.name, hint: installLine(agent, platform) ?? '' })),
      [],
      options.term,
    );
    const chosen = absent.filter((agent) => toInstall.includes(agent.id));
    if (chosen.length > 0) {
      for (const agent of chosen) options.say(`  ${agent.name}: ${installLine(agent, platform) ?? ''}`);
      if (await confirm('Run these install commands now?', false, options.term)) {
        for (const agent of chosen) {
          const line = installLine(agent, platform) ?? '';
          options.say(`Installing ${agent.name}: ${line}`);
          const ran = await runShell(options.run, platform, line);
          if (ran.code !== 0) {
            options.say(`${agent.name} did not install (exit ${String(ran.code)}). Its record is not written.`);
            continue;
          }
          taken.push(agent.id);
          plugins = withAgentPlugin(plugins);
          try {
            await takeAgent(agentRecords, agent.id);
          }
          catch (error) {
            stop(`The agent ${agent.id} could not be written as a record: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
    // A host that already has both was configured before this question existed,
    // and one of the two is dropped at the next start, so this is the run that
    // can keep only the backend.
    if (nativePi && configured.has('pi')
      && await confirm('Remove the ACP pi agent? It clashes with the pi backend.', true, options.term)) {
      plugins = withoutPreset(plugins, 'pi');
      try {
        await dropAgent(agentRecords, 'pi');
      }
      catch (error) {
        stop(`The agent record pi could not be removed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  for (const line of missingLines(found.missing, platform)) options.say(line);

  const host = await ask('Host', typeof held.host === 'string' ? held.host : '127.0.0.1', options.term);
  const typedPort = await ask('Port', String(typeof held.port === 'number' ? held.port : 9187), options.term);
  const port = Number(typedPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    stop(`Port must be a number from 0 to 65535, not ${typedPort}.`);
  }

  /*
   * The token, in a file beside the configuration.
   *
   * A secret written into `config.json` is one that anybody who can read that
   * file has, and the daemon already reads its secret out of a file of its own,
   * so what is asked here is what goes in that file. Enter generates one when
   * there is none and keeps the one there is, and anything else typed is the
   * token itself.
   */
  // A relative path is the configuration folder's, as the daemon reads it,
  // and the file keeps it as it was written.
  const tokenFile = typeof held.connectionTokenFile === 'string'
    ? besideFile(options.configFile, held.connectionTokenFile)
    : join(options.configDir, TOKEN);
  const fileToken = heldToken(tokenFile);
  /*
   * A token written as a literal is a token clients are already presenting, so
   * it is one of the things Enter keeps. Generating over it would lock out
   * every client that has it, and the question says which of the two it is
   * keeping rather than printing the secret back.
   */
  const literal = typeof held.connectionToken === 'string' && held.connectionToken !== '' ? held.connectionToken : undefined;
  const kept = fileToken ?? literal;
  const make = `generate one in ${tokenFile}`;
  const keep = fileToken === undefined ? `keep the token in ${options.configFile}` : `keep ${tokenFile}`;
  const typed = await ask('Connection token', kept === undefined ? make : keep, options.term);
  /*
   * The folder the token goes in, made before it is written.
   *
   * A first run on a machine that has never configured this daemon has no
   * configuration folder yet. The token is written before the configuration
   * file is, and it is that later write - `writeEntry` below - that makes the
   * folder, through `writeJsonAtomic`. `writeFileSync` makes none.
   */
  mkdirSync(dirname(tokenFile), { recursive: true });
  if (kept !== undefined && typed === keep) {
    if (fileToken !== undefined) options.say(`${tokenFile} still holds the token.`);
    else {
      writeFileSync(tokenFile, `${kept}\n`, { mode: 0o600 });
      options.say(`Wrote the token in ${options.configFile} to ${tokenFile}.`);
    }
  }
  else {
    const secret = typed === make ? randomUUID().replaceAll('-', '') : typed;
    // Owner-only, because the file is the credential.
    writeFileSync(tokenFile, `${secret}\n`, { mode: 0o600 });
    options.say(`${typed === make ? 'Wrote a new token to' : 'Wrote the token to'} ${tokenFile}.`);
  }
  if (typeof held.connectionTokenFile !== 'string') held.connectionTokenFile = tokenFile;
  // Two spellings of one secret is what `secret()` refuses, so the token this
  // run just placed in a file takes the literal one out.
  delete held.connectionToken;

  /*
   * The folders, each one asked about on its own.
   *
   * With none configured the folder the daemon was started in is the one it
   * serves, so that is the one asked about. Refusing every folder is not
   * written: an empty `paths` serves the current folder anyway, so the
   * questions are asked again with the reason, until one folder is kept.
   */
  let paths: string[] = [];
  while (paths.length === 0) {
    for (const folder of foldersIn(held)) {
      if (await confirm(`Serve ${folder}?`, true, options.term)) paths.push(folder);
    }
    if (paths.length === 0) {
      options.say(`Every folder was refused, and a daemon serves ${process.cwd()} unless "paths" names others. `
        + 'Answer Yes to one of them, or unset paths and start it where you want it served.');
    }
  }

  /*
   * The HTTP API and the model gateway, each on or off, and a port when on.
   *
   * Enter keeps what the file holds, and a file that names neither keeps both
   * off. A port is the listener of its own, and Enter at the port keeps the
   * daemon's own listener.
   */
  const httpApi = await listenerQuestion('HTTP API', held.httpApi, options.term, options.configFile);
  if (httpApi !== undefined) held.httpApi = httpApi;
  const modelApi = await listenerQuestion('model gateway', held.modelApi, options.term, options.configFile);
  if (modelApi !== undefined) held.modelApi = modelApi;

  /*
   * The plugin lists, as URLs split by commas, asked last.
   *
   * A question cannot answer with nothing, so `none` is the answer that reads
   * no list. Enter keeps what the file names, or the default, which is written
   * only when the file named the key already: a default left unwritten moves
   * with the next release.
   */
  const marketplaces = marketplacesOf(held);
  const shown = marketplaces.length === 0 ? 'none' : marketplaces.join(', ');
  const typedLists = (await ask('Plugin marketplaces', shown, options.term)).trim();
  if (typedLists !== shown || held.pluginMarketplaces !== undefined) {
    held.pluginMarketplaces = typedLists === 'none' ? [] : typedLists.split(',').map((one) => one.trim()).filter((one) => one !== '');
  }

  /*
   * The people, after the questions a daemon cannot start without.
   *
   * No is what Enter keeps, as `askToServe` keeps it for a folder: a person is
   * a grant, and Enter should not make one. A host with no users file is
   * given one beside the configuration, since a person needs a file to be
   * kept in, and `ahpd user add` refuses without one.
   */
  const added: string[] = [];
  let more = 'Add a person now?';
  while (await confirm(more, false, options.term)) {
    more = 'Add another person?';
    const id = (await ask('Their id', '', options.term)).trim();
    if (id === '' || id.startsWith('-')) {
      options.say('A person needs an id, such as alice. Nobody was added.');
      continue;
    }
    // Read against the configuration folder, as the daemon reads it, and kept
    // in the file as it was written.
    const file = typeof held.users === 'string' ? besideFile(options.configFile, held.users) : join(options.configDir, USERS);
    if (typeof held.users !== 'string') held.users = file;
    const directory = usersAt(file, held, (line) => { options.say(line); });
    const names = await directory.roleNames?.() ?? [];
    // A role the host does not define is refused by the directory, in words
    // that name the ones it has, and asked again.
    for (;;) {
      const typedRoles = await ask(`Roles (${names.join(', ')}; comma-separated)`, ROLE, options.term);
      const roles = typedRoles.split(',').map((one) => one.trim()).filter((one) => one !== '');
      try {
        await directory.add(id, roles.length === 0 ? [ROLE] : roles, {});
        added.push(id);
        options.say(`Added ${id} to ${file}.`);
        break;
      }
      catch (error) {
        options.say(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /*
   * The policy checks, on a host with people.
   *
   * A host with no users file is never checked, so it is not asked. Enter
   * keeps what the file holds, and the other keys of `policies` stay.
   */
  const policies = isRecord(held.policies) ? { ...held.policies } : {};
  if (typeof held.users === 'string') {
    const was = policies['check'] === true;
    const check = await confirm('Turn the policy checks on? A person no policy allows is refused.', was, options.term);
    // Written only where it says something: a No on a file that never named
    // the key leaves the file without it, as Enter at every question should.
    if (check !== was || Object.hasOwn(policies, 'check')) {
      policies['check'] = check;
      held.policies = policies;
    }
  }
  /*
   * One starter row for each kind that would refuse every person.
   *
   * Asked only with the checks on, which is when an empty kind refuses, so
   * Enter writes them. The rows are written after the file, and a daemon
   * reads them at its next start.
   */
  const starters: Policy[] = [];
  const store = policies['check'] === true ? filePolicies({ file: policiesPath(options.configDir), onProblem: (line) => { options.say(line); } }) : undefined;
  if (store !== undefined) {
    const rows = await store.list();
    const missing = STARTER_KINDS.filter((kind) => !rows.some((row) => coversAll(row, kind)));
    const opens = missing.includes('model') ? ' A model row opens every model to every person.' : '';
    if (missing.length > 0 && await confirm(`Allow every person every ${missing.join(', ')}?${opens}`, true, options.term)) {
      for (const kind of missing) {
        const id = `everyone-${kind}`;
        if (await store.get(id) !== undefined) {
          options.say(`The store already has a row ${id}, so no ${kind} row was written.`);
          continue;
        }
        starters.push({ id, scope: 'all', kind, effect: 'allow', match: { [kind]: ['*'] } });
      }
    }
  }

  held.host = host;
  held.port = port;
  held.paths = paths;
  // Only where there was a list to change: a first run has none yet, and
  // `installPlugins` below writes one.
  if (plugins.length > 0) held.plugins = plugins;
  writeEntry(options.configFile, held);
  options.say(`Wrote ${options.configFile}.`);
  if (store !== undefined && starters.length > 0) {
    for (const row of starters) {
      try {
        await store.put(row);
      }
      catch (error) {
        stop(`The row ${row.id} could not be written: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    options.say(`Wrote ${starters.map((row) => row.id).join(', ')} to ${policiesPath(options.configDir)}. A running daemon reads them when it starts again.`);
  }

  // A set, because the package every taken agent runs through is also a backend
  // when ACP is on, and it is installed once.
  const missing = [...new Set([
    ...backends.filter((one) => !installed.has(one)),
    ...others.filter((one) => !installed.has(one)),
    // The package every taken agent runs through, installed with them rather
    // than before the questions, because a first run has no entry for it yet.
    ...(taken.length > 0 && !installed.has(AGENT_PLUGIN) ? [AGENT_PLUGIN] : []),
  ])];
  if (missing.length > 0) {
    await installPlugins(missing, {
      configDir: options.configDir, configFile: options.configFile,
      sdk: options.sdk, enable: true, run: options.run, fetch: options.fetch, say: options.say,
    });
  }
  else if (backends.length > 0) options.say(`Every backend is already named in ${options.configFile}.`);

  /*
   * What to run next, as `kubeadm init` ends.
   *
   * The command that prints a person's credential, and not the credential: a
   * secret is printed when somebody asks for it.
   */
  for (const id of added) options.say(`To connect as ${id}: ahpd user token ${id} --url`);

  return { path: options.configFile, backends, paths, added };
}

/**
 * Run `ahpd configure` against a file, over a terminal, with npm for real.
 *
 * What the command and the offer below both do, so neither writes the six lines
 * it takes to name the directory, the sdk and the runner.
 */
export async function runConfigure(configFile: string, term: Term, say: (line: string) => void): Promise<void> {
  await configure({ configDir: configDir(), configFile, sdk: sdkVersion(), term, run: runProgram, fetch, say });
}

/** What the offer is given, so a caller can answer for it rather than run npm. */
export interface OfferOptions {
  /** The configuration file that is not there. */
  configFile: string;
  /** The terminal to ask on. */
  term: Term;
  /** One line of the asking command's own output. */
  say(line: string): void;
  /** How `ahpd configure` is run when the answer is yes. Replaced in a test. */
  run?: () => Promise<void>;
}

/**
 * Offer `ahpd configure` to a daemon with no configuration file, and run it.
 *
 * Answers whether it was run, which the caller reads by starting as it meant
 * to: a run that was configured reads the file that was just written.
 *
 * Nothing is asked without a terminal, so a script and a service carry on to the
 * refusal they get today rather than blocking on a prompt no one can see. The
 * question is asked before anything is started, so the detached child `ahpd
 * start` spawns, which has no terminal of its own, never asks one.
 */
export async function offerConfigure(options: OfferOptions): Promise<boolean> {
  if (existsSync(options.configFile) || !answering(options.term)) return false;
  const wanted = await confirm('No configuration. Run ahpd configure now?', true, options.term);
  if (!wanted) {
    options.say('Not run. Nothing was configured.');
    return false;
  }
  await (options.run ?? (() => runConfigure(options.configFile, options.term, options.say)))();
  return true;
}

/**
 * Whether a folder is one of the folders, or is under one of them, compared as
 * VS Code's agent host compares a folder with a trusted one: the case of a
 * letter ignored except on Linux, whose file systems tell cases apart, as
 * VS Code's `extUriBiasedIgnorePathCase` and `startsWithIgnoreCase` ignore an
 * ASCII letter's case.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostWorkspaceTrust.ts#L29
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/extpath.ts#L227-L273
 */
export const under = (folder: string, served: string, ignoreCase = process.platform !== 'linux'): boolean => {
  const folded = (path: string): string => (ignoreCase ? path.replace(/[A-Z]/gu, (one) => one.toLowerCase()) : path);
  const inside = folded(resolve(folder));
  const above = folded(resolve(served));
  return inside === above || inside.startsWith(above.endsWith(sep) ? above : `${above}${sep}`);
};

/**
 * Ask to serve the folder this was started in, and keep the answer.
 *
 * A folder a host serves is one its agents read, edit and run in, which is what
 * Claude Code asks a person to trust before it does, so a folder under none of
 * them is asked about rather than served quietly.
 *
 * Yes writes the folder to the configuration file, so it is asked once, and adds
 * it to this run's folders, because the options were read before the question
 * was asked. Everything else starts without it: a folder already under one that
 * is served, `--no-cwd`, and a terminal with nobody to answer on.
 */
export async function askToServe(options: Options, configFile: string, term: Term, say: (line: string) => void): Promise<void> {
  if (options.noCwd || !answering(term)) return;
  const folder = resolve(process.cwd());
  if (options.paths.some((one) => under(folder, one))) return;
  // No is what Enter keeps, because a folder is a grant and Enter should not
  // make one.
  if (!await confirm(`Serve ${folder}?`, false, term)) return;
  const held = readEntry(configFile);
  const paths = Array.isArray(held.paths) ? held.paths.filter((one): one is string => typeof one === 'string') : [];
  writeEntry(configFile, { ...held, paths: [...paths, folder] });
  options.paths.push(folder);
  say(`Added ${folder} to "paths" in ${configFile}.`);
}

export const declareConfigure = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.configure',
  summary: 'Ask for each setting a first install needs, and write it',
  description: 'Every question shows the value the configuration holds now, and Enter keeps it. A backend chosen and not already named is installed into the configuration directory.',
  surfaces: { cli: { pattern: ['configure'] } },
  input: { configFile: serverFields.configFile },
  run: async (context) => {
    // With a payload asked for, the lines are diagnostics and go to stderr,
    // because stdout is the answer.
    const payload = context.globals['json'] === true || context.globals['quiet'] === true;
    const done = await configure({
      configDir: configDir(),
      configFile: context.optional<string>('configFile') ?? configPath(),
      sdk: sdkVersion(),
      term: here,
      run: runProgram,
      fetch,
      say: (line) => {
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      },
    });
    // The offer at a first start starts the daemon next, so only the command
    // says how to.
    const next: [string, string][] = [
      ['ahpd start', 'Start the daemon'],
      ['ahpd status', 'Check status and listening addresses'],
      ['ahpd configure', 'Change an answer later, with the same questions'],
    ];
    if (!payload && answering(here)) {
      // The commands are coloured here, and the words after them are lined up
      // on the plain width, since the colour codes take no room on the screen.
      const width = Math.max(...next.map(([command]) => command.length)) + 3;
      await report(done.path, next.map(([command, meaning]) => `${styleText('cyan', command, { stream: process.stdout })}${' '.repeat(width - command.length)}${meaning}`), here);
    }
    else {
      // Without a terminal, the commands are plain lines; the colour is only
      // where the stream is a terminal, and the names line up in one column.
      const stream = payload ? process.stderr : process.stdout;
      const width = Math.max(...next.map(([command]) => command.length)) + 3;
      for (const [command, meaning] of next) {
        const line = `${styleText('cyan', command, { stream })}${' '.repeat(width - command.length)}${meaning}`;
        if (payload) context.error(line);
        else context.write(`${line}\n`);
      }
    }
    return output(done, '');
  },
});