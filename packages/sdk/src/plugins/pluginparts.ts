/**
 * The parts a plugin holds, read off the copy on this host's disk.
 *
 * A client hands a session a plugin as a URI and a revision, and the host copies
 * it to a directory here before any backend can open it. What the plugin holds
 * is read here: its agents, skills, rules, hooks and MCP servers, as the
 * `children` of its entry in the session's customizations. A client reads that
 * list to show what a plugin brings, and switches one of its servers off from it.
 *
 * Two formats are read, which are the two a plugin is handed over in: a Claude
 * plugin, whose manifest is `.claude-plugin/plugin.json`, and an Open Plugins
 * one, whose manifest is `.plugin/plugin.json`. A directory with neither is a
 * plugin this host lists with no parts rather than one it guesses a format for.
 * Both formats keep their hooks in `hooks/hooks.json` and their servers in
 * `.mcp.json`, and both let the manifest move any of that or declare it inline.
 *
 * A part is named the way VS Code's agent host names one: by the URI of its own
 * file inside this copy, and that URI is the part's id as well. The copy is what
 * is read, so the copy is what a part is named by, and a client that reads one
 * reads the file the host would. A server has no file of its own - several sit
 * in one - so the URI of the file that declares it carries the server's name in
 * a fragment, which is what tells two servers of one file apart.
 *
 * A rule is read past its name: its file's frontmatter becomes fields of its
 * part - what the rule is for, whether it always applies, and the files it
 * applies to - and the text below it is kept beside the part rather than in it,
 * because a client is told what a rule is for and not the words of it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { readJsonObject } from '../utils/jsonfile.js';
import { isRecord, strings } from '../utils/values.js';
import type { Bag } from '../types/common.js';
import { mcpServerCustomization } from './mcpserver.js';

/** One part as it was found: what it is called, and the file it came out of. */
interface Found {
  readonly name: string;
  readonly path: string;
}

/**
 * One rule as its file was read: what it is called, the fields its frontmatter
 * writes, and the text below it.
 *
 * The body is the words an agent is told, which is no part of what a client
 * reads of the rule: it is kept beside the part rather than on it.
 */
interface Rule extends Found {
  readonly fields: Bag;
  readonly body: string;
}

/** Where one format keeps its manifest, and the hooks file it reads when the manifest names none. */
interface Format {
  readonly manifest: string;
  readonly hooks: string;
}

/**
 * The two formats this host reads, in the order it looks for one.
 *
 * A Claude plugin and an Open Plugins one agree on where everything else is and
 * differ in the manifest alone, so the manifest is all that is listed here.
 */
const FORMATS: readonly Format[] = [
  { manifest: '.claude-plugin/plugin.json', hooks: 'hooks/hooks.json' },
  { manifest: '.plugin/plugin.json', hooks: 'hooks/hooks.json' },
];

/** The suffix a rule's file carries, and the longer one the other spelling carries. */
const RULE_SUFFIX = '.mdc';
const INSTRUCTION_SUFFIX = '.instructions.md';

/** The lifecycle events a hooks file may name, in either spelling a format writes them. */
const HOOK_EVENTS = new Set([
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'ErrorOccurred',
  'sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse',
  'agentStop', 'subagentStop', 'errorOccurred',
]);

/** The fields a hook entry runs its command from, the command itself first. */
const COMMAND_FIELDS = ['command', 'bash', 'powershell', 'windows', 'linux', 'osx'];

/** A file that is there. */
const isFile = (path: string): boolean => {
  try { return statSync(path).isFile(); } catch { return false; }
};

/** A directory that is there. */
const isDir = (path: string): boolean => {
  try { return statSync(path).isDirectory(); } catch { return false; }
};

/** What is directly under a directory, and nothing at all for a directory that is not there. */
const children = (dir: string, wanted: (path: string) => boolean): string[] => {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.map((name) => join(dir, name)).filter(wanted);
};

/** The files directly under one, which is where the parts of a component sit. */
const filesIn = (dir: string): string[] => children(dir, isFile);

/** The directories directly under one, which is where a skill's `SKILL.md` is looked for. */
const dirsIn = (dir: string): string[] => children(dir, isDir);

/** A path inside another, which is where every path a manifest names has to land. */
const within = (root: string, path: string): boolean => {
  const rest = relative(root, path);
  return !rest.startsWith('..') && !isAbsolute(rest);
};

/** One part before another, by the name a person reads. */
const byName = (one: Found, other: Found): number => one.name.localeCompare(other.name);

/**
 * Where a component's files are, as a manifest names them.
 *
 * A manifest names one place as a string, as a list of strings, or as an object
 * with `paths` and `exclusive`. `exclusive` drops the conventional folder, so a
 * plugin that says where its skills are has its skills only there.
 */
interface Places {
  readonly paths: readonly string[];
  readonly exclusive: boolean;
}

/** A manifest that names nowhere, which is every manifest that does not mention the component. */
const NOWHERE: Places = { paths: [], exclusive: false };

/** The names in a manifest's list, each without the space around it and none of them empty. */
const namesIn = (values: unknown): string[] =>
  strings(values).map((one) => one.trim()).filter((one) => one !== '');

const placesIn = (named: unknown): Places => {
  if (typeof named === 'string') {
    const one = named.trim();
    return one === '' ? NOWHERE : { paths: [one], exclusive: false };
  }
  if (Array.isArray(named)) return { paths: namesIn(named), exclusive: false };
  if (isRecord(named) && Array.isArray(named.paths)) {
    return { paths: namesIn(named.paths), exclusive: named.exclusive === true };
  }
  return NOWHERE;
};

/**
 * The places a component is read from: the conventional one, unless the manifest
 * drops it, and then whatever the manifest names instead.
 *
 * A path that leaves the plugin is dropped rather than read. The copy is the
 * client's content, and a manifest is not a way to reach past what it sent.
 */
const placesFor = (dir: string, usual: string, section: unknown): string[] => {
  const places = placesIn(section);
  const found = places.exclusive ? [] : [join(dir, usual)];
  for (const one of places.paths) {
    const at = join(dir, one);
    if (within(dir, at)) found.push(at);
  }
  return found;
};

/** Whether a component is declared in the manifest file itself: an object that names no `paths`. */
const declaredInline = (section: unknown): Record<string, unknown> | undefined =>
  (isRecord(section) && !Object.hasOwn(section, 'paths') ? section : undefined);

/** Every file a place holds: the place itself where it is a file, and otherwise what is directly under it. */
const filesAt = (places: readonly string[]): string[] =>
  places.flatMap((place) => (isFile(place) ? [place] : filesIn(place)));

/** The files of a component by their name, the first of a name winning, sorted by name. */
const namedFiles = (paths: readonly string[], nameOf: (path: string) => string | undefined): Found[] => {
  const found = new Map<string, Found>();
  for (const path of paths) {
    const name = nameOf(path);
    if (name !== undefined && !found.has(name)) found.set(name, { name, path });
  }
  return [...found.values()].sort(byName);
};

/** The `.md` files of a component, each named without the suffix, which is how an agent is named. */
const markdownIn = (places: readonly string[]): Found[] =>
  namedFiles(filesAt(places), (path) =>
    (extname(path).toLowerCase() === '.md' ? basename(path).slice(0, -'.md'.length) : undefined));

/** The suffix a rule's file carries, which is what comes off the name, or nothing where the file is not a rule. */
const ruleSuffix = (path: string): string | undefined => {
  const name = basename(path).toLowerCase();
  if (name.endsWith(RULE_SUFFIX)) return RULE_SUFFIX;
  if (name.endsWith(INSTRUCTION_SUFFIX)) return INSTRUCTION_SUFFIX;
  return undefined;
};

/** The line a rule's frontmatter opens and closes with. */
const FENCE = '---';

/** One field of a frontmatter, as `key: value`, at the left margin where a frontmatter's own fields sit. */
const FIELD = /^([A-Za-z_][\w.-]*):[ \t]*(.*)$/;

/** One item of a list written down a line at a time, as `- value`, indented under the field it is for. */
const ITEM = /^[ \t]+-[ \t]+(.*)$/;

/** A written value without the quotes around it, where it is written with any. */
const unquoted = (written: string): string => {
  const quoted = /^(['"])(.*)\1$/.exec(written);
  return quoted === null ? written : (quoted[2] as string);
};

/** One frontmatter value as it is written: a list between brackets, a `true` or `false`, and anything else text. */
const valueOf = (written: string): string | boolean | string[] => {
  const bracketed = /^\[(.*)\]$/.exec(written);
  if (bracketed !== null) {
    return (bracketed[1] as string).split(',').map((one) => unquoted(one.trim())).filter((one) => one !== '');
  }
  if (written === 'true') return true;
  if (written === 'false') return false;
  return unquoted(written);
};

/** The `- item` lines directly under a field, which is how a list is written one line at a time. */
const itemsUnder = (lines: readonly string[], from: number): string[] => {
  const items: string[] = [];
  for (const line of lines.slice(from)) {
    const item = ITEM.exec(line);
    if (item === null) break;
    items.push(unquoted((item[1] as string).trim()));
  }
  return items;
};

/** The fields a run of frontmatter lines writes, each with the value under it. */
const fieldsIn = (lines: readonly string[]): Bag => {
  const fields: Bag = {};
  for (const [at, line] of lines.entries()) {
    const field = FIELD.exec(line);
    if (field === null) continue;
    const key = field[1] as string;
    const written = (field[2] as string).trim();
    // A field with nothing after its colon holds the list written under it, or
    // nothing at all where no list follows - which is a comment, or a mapping
    // this host reads none of.
    if (written === '') {
      const items = itemsUnder(lines, at + 1);
      if (items.length > 0) fields[key] = items;
      continue;
    }
    fields[key] = valueOf(written);
  }
  return fields;
};

/**
 * A rule file's frontmatter as the fields it writes, and the text below it.
 *
 * Every field the frontmatter writes is read, and the three the protocol names
 * are the ones a part keeps. The body is that text without the blank space
 * around it, because it is the words an agent is told rather than a file. A
 * file that does not open with a `---` line, or that never closes one, is a
 * rule no frontmatter can be read out of: it carries no field and its whole
 * text is the body, which is the same answer a rule written with no frontmatter
 * gives.
 */
const readRule = (path: string): { fields: Bag; body: string } => {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch { return { fields: {}, body: '' }; }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if ((lines[0] ?? '').trim() !== FENCE) return { fields: {}, body: text.trim() };
  const closes = lines.findIndex((line, at) => at > 0 && line.trim() === FENCE);
  if (closes === -1) return { fields: {}, body: text.trim() };
  return { fields: fieldsIn(lines.slice(1, closes)), body: lines.slice(closes + 1).join('\n').trim() };
};

/** The fields a rule's part carries, off the frontmatter it wrote and only where it wrote one. */
const ruleFields = (fields: Bag): Bag => ({
  ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
  ...(typeof fields.alwaysApply === 'boolean' ? { alwaysApply: fields.alwaysApply } : {}),
  ...(Array.isArray(fields.globs) && fields.globs.length > 0 ? { globs: fields.globs } : {}),
});

/** The rule files of a component, each named without its suffix and each read once. */
const rulesIn = (places: readonly string[]): Rule[] =>
  namedFiles(filesAt(places), (path) => {
    const suffix = ruleSuffix(path);
    return suffix === undefined ? undefined : basename(path).slice(0, -suffix.length);
  }).map((one) => ({ ...one, ...readRule(one.path) }));

/**
 * The skills a plugin holds, each named after the directory its `SKILL.md` is in.
 *
 * A place that has a `SKILL.md` of its own is one skill named after the place,
 * so a `triage` folder is a skill and so is a `skills` folder holding one file.
 * Otherwise every directory under the place with a `SKILL.md` is a skill.
 */
const skillsIn = (places: readonly string[]): Found[] => {
  const found = new Map<string, Found>();
  const add = (name: string, path: string): void => {
    if (!found.has(name)) found.set(name, { name, path });
  };
  for (const place of places) {
    const own = join(place, 'SKILL.md');
    if (isFile(own)) { add(basename(place), own); continue; }
    for (const dir of dirsIn(place)) {
      const skill = join(dir, 'SKILL.md');
      if (isFile(skill)) add(basename(dir), skill);
    }
  }
  return [...found.values()].sort(byName);
};

/** The skills of a plugin, and the `SKILL.md` at its own root where it holds none anywhere else. */
const skillsOf = (dir: string, places: readonly string[]): Found[] => {
  const found = skillsIn(places);
  if (found.length > 0) return found;
  const root = join(dir, 'SKILL.md');
  return isFile(root) ? [{ name: basename(dir), path: root }] : [];
};

/** Whether one hook entry runs a command of its own. */
const namesCommand = (entry: unknown): boolean => {
  if (!isRecord(entry)) return false;
  if (entry.type !== undefined && entry.type !== 'command') return false;
  return COMMAND_FIELDS.some((one) => typeof entry[one] === 'string' && entry[one] !== '');
};

/** Whether one entry of a lifecycle runs a command: its own, or one under the `hooks` it carries. */
const entryCommands = (entry: unknown): boolean =>
  (isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks.some(namesCommand) : namesCommand(entry));

/** Whether a hooks file declares anything: a lifecycle this host knows, with a command under it. */
const declaresHooks = (json: unknown): boolean => {
  if (!isRecord(json) || json.disableAllHooks === true) return false;
  const events = isRecord(json.hooks) ? json.hooks : json;
  return Object.entries(events).some(([id, entries]) =>
    (HOOK_EVENTS.has(id) && Array.isArray(entries) && entries.some(entryCommands)));
};

/**
 * The hooks file a plugin declares in, which is one part or none.
 *
 * A manifest may hold the hooks itself rather than name a file, and then the
 * manifest is the file they are declared in. Otherwise the places are read in
 * order and the first that is there and declares a command is the one.
 */
const hooksIn = (dir: string, format: Format, section: unknown): Found[] => {
  const manifest = join(dir, format.manifest);
  const inline = declaredInline(section);
  if (inline !== undefined && declaresHooks(inline)) return [{ name: basename(manifest), path: manifest }];
  for (const place of placesFor(dir, format.hooks, section)) {
    const read = readJsonObject(place);
    if (read.ok && declaresHooks(read.value)) return [{ name: basename(place), path: place }];
  }
  return [];
};

/** The servers a file declares: the map under `mcpServers`, or the file itself where it holds them bare. */
const serversIn = (json: unknown): string[] => {
  if (!isRecord(json)) return [];
  const map = isRecord(json.mcpServers) ? json.mcpServers : json;
  // A name whose value is not an object names no server: the protocol asks for a
  // configuration, and a string in its place is a server this host cannot read.
  return Object.entries(map)
    .filter(([, config]) => isRecord(config))
    .map(([name]) => name)
    .sort((one, other) => one.localeCompare(other));
};

/**
 * The servers a plugin declares, each with the file it is declared in.
 *
 * Servers the manifest holds itself are declared in the manifest, and they win
 * over anything on disk when there are any. Otherwise each place is read and the
 * first file to declare a name is the one that server is in, so a second file
 * naming it again does not move it.
 */
const serversOf = (dir: string, format: Format, section: unknown): Found[] => {
  const manifest = join(dir, format.manifest);
  const inline = declaredInline(section);
  const written = inline === undefined
    ? []
    : serversIn({ mcpServers: inline }).map((name) => ({ name, path: manifest }));
  if (written.length > 0) return written;
  const found = new Map<string, Found>();
  for (const place of placesFor(dir, '.mcp.json', section)) {
    const read = readJsonObject(place);
    if (!read.ok) continue;
    for (const name of serversIn(read.value)) {
      if (!found.has(name)) found.set(name, { name, path: place });
    }
  }
  return [...found.values()].sort(byName);
};

/** The format a copy is in and its manifest read, or nothing where the format is not one this host reads. */
const heldFormat = (dir: string): { format: Format; manifest: Bag } | undefined => {
  const format = FORMATS.find((one) => existsSync(join(dir, one.manifest)));
  if (format === undefined) return undefined;
  const read = readJsonObject(join(dir, format.manifest));
  return { format, manifest: read.ok ? read.value : {} };
};

/**
 * What one file of a copy is called: the copy's URI, then the file's path under
 * it, one URI segment at a time.
 *
 * A folder or a file is named in a URI as an escaped segment, so the name goes
 * in escaped: a file called `my agent.md` is `my%20agent.md`, which is what a
 * reader of the part's URI opens. A directory handed over with a trailing slash
 * would otherwise name every part of it with two.
 */
const namerOf = (dir: string, uri: string): ((path: string) => string) => {
  const base = uri.endsWith('/') ? uri.slice(0, -1) : uri;
  return (path) => `${base}/${relative(dir, path).split(sep).map(encodeURIComponent).join('/')}`;
};

/** One part named by its file, which is a part with a file of its own: everything but a server. */
const partOf = (type: string, one: Found, at: (path: string) => string, fields: Bag = {}): Bag => {
  const where = at(one.path);
  return { type, id: where, uri: where, name: one.name, ...fields };
};

/** The rules of a copy: the part a client reads of each, and the body an agent is told. */
const rulesWith = (dir: string, manifest: Bag, at: (path: string) => string): { part: Bag; body: string }[] =>
  rulesIn(placesFor(dir, 'rules', manifest.rules)).map((one) => ({
    part: partOf('rule', one, at, ruleFields(one.fields)),
    body: one.body,
  }));

/**
 * The rules a plugin's copy holds, each with the part a client reads of it and
 * the body an agent is told, or nothing where its format is not one this host
 * reads - the same answer `partsOf` gives for such a copy.
 *
 * The body is what the host builds the system prompt from, and a part carries
 * none of it, so a caller that wants the words asks for them here.
 */
export function rulesOf(dir: string, uri: string): { part: Bag; body: string }[] | undefined {
  const held = heldFormat(dir);
  return held === undefined ? undefined : rulesWith(dir, held.manifest, namerOf(dir, uri));
}

/**
 * The parts a plugin holds, or nothing where its format is not one this host reads.
 *
 * `dir` is the plugin's directory on this host's disk and `uri` is that same
 * directory as a URI, which is what its parts are named under: a part is read
 * from a path here and named by where it landed, so the two are handed over
 * together rather than one being worked out from the other.
 *
 * A plugin whose manifest is there and which holds nothing answers an empty
 * list, and that is a different answer from this one: an empty list is a plugin
 * that was read and contributes nothing, and nothing at all is a plugin nobody
 * has read yet.
 *
 * The order is VS Code's, which is the order a client reads a plugin in: agents,
 * skills, rules, hooks, then servers. Two parts with one id are one part, so a
 * file reached by two of the manifest's places is listed once.
 */
export function partsOf(dir: string, uri: string): Bag[] | undefined {
  const held = heldFormat(dir);
  if (held === undefined) return undefined;
  const { format, manifest } = held;
  const at = namerOf(dir, uri);
  /**
   * One server's part.
   *
   * Its file is the one that declares it, and the server's own name goes in a
   * fragment of the id, so two servers of one file are two parts. A `#` the
   * file's URI already carries is escaped first, so a name that looks like a
   * fragment cannot collide with one that was there.
   *
   * The state is the one a declared server is in: no backend has started it, and
   * `stopped` is what says so without claiming a turn is coming.
   */
  const server = (one: Found): Bag => mcpServerCustomization(at(one.path), one.name, { kind: 'stopped' });

  const agents = markdownIn(placesFor(dir, 'agents', manifest.agents));
  const skills = skillsOf(dir, placesFor(dir, 'skills', manifest.skills));
  // A rule's part is built where its body is read, so that the two are read off
  // the file once and a rule part is built in one place only.
  const rules = rulesWith(dir, manifest, at);
  const hooks = hooksIn(dir, format, manifest.hooks);
  const servers = serversOf(dir, format, manifest.mcpServers);

  const parts: Bag[] = [];
  const listed = new Set<string>();
  const add = (one: Bag): void => {
    if (listed.has(one.id as string)) return;
    listed.add(one.id as string);
    parts.push(one);
  };
  for (const one of agents) add(partOf('agent', one, at));
  for (const one of skills) add(partOf('skill', one, at));
  for (const one of rules) add(one.part);
  for (const one of hooks) add(partOf('hook', one, at));
  for (const one of servers) add(server(one));
  return parts;
}
