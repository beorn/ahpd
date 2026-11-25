/** The skills a session's MCP servers serve, listed under each server and loaded by the CLI (SEP-2640). */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { connectMcp, expandServer } from '@cofold/mcp-client';
import type { McpConnection, McpServerConfig, McpSkillInfo } from '@cofold/mcp-client';
import type { Bag } from '@ahpd/sdk';
import { bag, str } from './common.js';

/** The name of the plugin the CLI loads the skills from, which is the namespace it runs each under. */
export const MCP_SKILLS_PLUGIN = 'mcp-skills';

/** How long one call to a server may take. */
const WAIT_MS = 10_000;
/** The most one server's skills may come to, past which the rest are left out. */
const MOST = { skills: 64, files: 64, fileBytes: 1024 * 1024, bytes: 8 * 1024 * 1024 };
/** A skill's name, by the Agent Skills format: a folder name that names nothing else. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** One skill, as the session holds it. */
interface Held {
  id: string;
  uri: string;
  name: string;
  description: string;
  files: { path: string; bytes: Buffer }[];
}

/** One server's answer, and the configuration it was asked with. */
interface Asked {
  config: string;
  skills: Held[] | undefined;
}

/**
 * Which skills a person switched, by session: kept past the CLI of one chat,
 * and gone with the process, as VS Code's host keeps them.
 * https://github.com/microsoft/vscode/blob/7e993177c9d9/src/vs/platform/agentHost/node/agentHostCustomizationEnablementService.ts#L164
 */
const choices = new Map<string, Map<string, boolean>>();

/** What this area offers the rest of the session. */
export interface McpSkills {
  /** The plugin folder the CLI starts with, made where the session has a server to ask. */
  folder(): string | undefined;
  /** Ask each connected server that was not asked as it is configured now. Answers whether anything moved. */
  refresh(connected: readonly string[], configs: Record<string, Bag>): Promise<boolean>;
  /** Lay each server's skills on its row. */
  lay(rows: Bag[]): void;
  /** Switch one skill by its id; false where the id names none. */
  toggle(id: string, enabled: boolean): boolean;
  /** Whether a name the CLI reports is one of these, which its server's row lists. */
  mine(name: string): boolean;
  close(): void;
}

/** A server's configuration as the client takes one, or nothing for a kind it does not speak. */
const configOf = (given: Bag, cwd: string | undefined, env: NodeJS.ProcessEnv): McpServerConfig | undefined => {
  const type = str(given.type);
  const strings = (value: unknown): Record<string, string> =>
    Object.fromEntries(Object.entries(bag(value)).filter((one): one is [string, string] => typeof one[1] === 'string'));
  if (type === 'http' && typeof given.url === 'string')
    return expandServer({ type: 'http', url: given.url, headers: strings(given.headers) }, env, () => {});
  if ((type === undefined || type === 'stdio') && typeof given.command === 'string') {
    /*
     * The environment the CLI starts its servers with. The client starts a
     * server over this process's own, so what the CLI's leaves out is blanked:
     * a server is handed nothing the CLI would not hand it.
     */
    const blank = Object.fromEntries(Object.keys(process.env).filter((name) => env[name] === undefined).map((name) => [name, '']));
    const own = Object.fromEntries(Object.entries(env).filter((one): one is [string, string] => typeof one[1] === 'string'));
    return expandServer({
      command: given.command,
      args: Array.isArray(given.args) ? given.args.filter((one): one is string => typeof one === 'string') : [],
      env: { ...blank, ...own, ...strings(given.env) },
      ...(cwd === undefined ? {} : { cwd }),
    }, env, () => {});
  }
  return undefined;
};

/** Where a file sits in its skill, or nothing for one that is not inside it. */
const pathIn = (root: string, uri: string): string | undefined => {
  if (!uri.startsWith(`${root}/`)) return undefined;
  let path: string;
  try { path = decodeURIComponent(uri.slice(root.length + 1)); }
  catch { return undefined; }
  const parts = path.split('/');
  return parts.some((one) => one === '' || one === '.' || one === '..' || /[\\:\0]/.test(one)) ? undefined : path;
};

/** One skill's files, read and checked against what the server said of each. */
const readSkill = async (connection: McpConnection, given: McpSkillInfo, id: string, room: { bytes: number }): Promise<Held | undefined> => {
  const root = given.uri.endsWith('/SKILL.md') ? given.uri.slice(0, -'/SKILL.md'.length) : undefined;
  const name = str(bag(given.frontmatter).name);
  // The format's rule, which also makes the name a safe folder: the skill's
  // folder is called what the skill is.
  if (root === undefined || name === undefined || !NAME.test(name) || root.split('/').at(-1) !== name) return undefined;
  const listed = Array.isArray(given.resources) ? given.resources : [{ uri: given.uri, digest: undefined, size: undefined }];
  if (listed.length > MOST.files || !listed.some((one) => one.uri === given.uri)) return undefined;
  const files: Held['files'] = [];
  for (const one of listed) {
    const path = pathIn(root, one.uri);
    if (path === undefined || (one.size !== undefined && one.size > MOST.fileBytes)) return undefined;
    const content = (await connection.read(one.uri, { timeoutMs: WAIT_MS })).find((entry) => entry.uri === one.uri);
    const bytes = typeof content?.text === 'string' ? Buffer.from(content.text, 'utf8')
      : typeof content?.blob === 'string' ? Buffer.from(content.blob, 'base64') : undefined;
    if (bytes === undefined || bytes.length > MOST.fileBytes || (room.bytes -= bytes.length) < 0) return undefined;
    // A read that is not what was listed is one the specification has a host refuse.
    if (one.digest !== undefined && one.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`) return undefined;
    if (one.size !== undefined && one.size !== bytes.length) return undefined;
    files.push({ path, bytes });
  }
  return { id, uri: given.uri, name, description: str(bag(given.frontmatter).description) ?? '', files };
};

/** One line of plain text, for a place that reads one line. */
const line = (text: string, most: number): string => text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim().slice(0, most);

export function createMcpSkills(options: {
  session: string;
  cwd: string | undefined;
  /** Whether this session's servers run on this host, which is the only place they can be asked from. */
  here: boolean;
  env: () => NodeJS.ProcessEnv;
  version: string;
  warn: (line: string) => void;
  connect?: typeof connectMcp;
}): McpSkills {
  const connect = options.connect ?? connectMcp;
  const asked = new Map<string, Asked>();
  /** The id of each server's row, by its name: what a skill's id starts with. */
  const rows = new Map<string, string>();
  let made: string | undefined;
  /** What the folder holds, so it is written again only where that moved. */
  let written: string | undefined;
  let closed = false;

  const onFor = (id: string): boolean => choices.get(options.session)?.get(id) !== false;
  const idOf = (server: string, uri: string): string => `${server}#skill=${encodeURIComponent(uri)}`;

  const ask = async (name: string, given: Bag): Promise<Held[] | undefined> => {
    const config = configOf(given, options.cwd, options.env());
    if (config === undefined) return undefined;
    let connection: McpConnection | undefined;
    try {
      connection = await connect({ name, server: config, clientInfo: { name: 'ahpd', version: options.version }, timeoutMs: WAIT_MS });
      if (!connection.servesSkills) return [];
      const room = { bytes: MOST.bytes };
      const held: Held[] = [];
      for (const one of (await connection.skills({ timeoutMs: WAIT_MS })).slice(0, MOST.skills)) {
        const read = await readSkill(connection, one, one.uri, room).catch(() => undefined);
        if (read === undefined) options.warn(`${name}: the skill ${line(String(one.uri), 200)} was left out: it is not as the server listed it, or too large`);
        else held.push(read);
      }
      return held;
    }
    catch (error) {
      options.warn(`${name}: its skills could not be read: ${line(error instanceof Error ? error.message : String(error), 300)}`);
      return undefined;
    }
    finally {
      await connection?.close().catch(() => {});
    }
  };

  /*
   * The folder brought to the skills that are on.
   *
   * A `SKILL.md` of this host's own, and the server's beside it as a plain
   * file. The CLI runs a skill's `!` lines and its `hooks`, and takes its
   * `allowed-tools`, as it loads it, and a server over the network that could
   * write those would run commands here that nobody was asked about. What the
   * server wrote is text the model reads with a tool, as any file's is.
   */
  const write = (): void => {
    if (made === undefined) return;
    const on = [...asked].flatMap(([server, { config, skills: held }]) => (held ?? []).flatMap((skill) => {
      const row = rows.get(server);
      return row !== undefined && onFor(idOf(row, skill.uri)) ? [[server, config, skill.uri]] : [];
    }));
    const now = JSON.stringify(on);
    if (now === written) return;
    written = now;
    const skills = join(made, 'skills');
    rmSync(skills, { recursive: true, force: true });
    mkdirSync(skills, { recursive: true });
    const taken = new Set<string>();
    for (const [server, { skills: held }] of asked) {
      for (const skill of held ?? []) {
        const row = rows.get(server);
        if (row === undefined || !onFor(idOf(row, skill.uri)) || taken.has(skill.name)) continue;
        taken.add(skill.name);
        const root = join(skills, skill.name);
        for (const file of skill.files) {
          const path = file.path === 'SKILL.md' ? 'INSTRUCTIONS.md' : file.path;
          const at = resolve(root, 'files', path);
          if (!at.startsWith(resolve(root, 'files') + sep)) continue;
          mkdirSync(dirname(at), { recursive: true });
          writeFileSync(at, file.bytes);
        }
        writeFileSync(join(root, 'SKILL.md'), [
          '---',
          `name: ${skill.name}`,
          `description: ${JSON.stringify(line(skill.description, 1024))}`,
          '---',
          '',
          `The MCP server ${JSON.stringify(line(server, 100))} serves this skill. Read \`files/INSTRUCTIONS.md\` in this skill's folder and follow it. Files it names are beside it, in \`files/\`.`,
          '',
        ].join('\n'));
      }
    }
  };

  return {
    folder: () => {
      if (!options.here || closed) return undefined;
      if (made === undefined) {
        made = mkdtempSync(join(tmpdir(), 'ahpd-mcp-skills-'));
        mkdirSync(join(made, '.claude-plugin'));
        writeFileSync(join(made, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: MCP_SKILLS_PLUGIN, version: '0.0.0', description: 'The skills this session\'s MCP servers serve' }));
        write();
      }
      return made;
    },
    refresh: async (connected, configs) => {
      if (!options.here || closed) return false;
      let moved = false;
      for (const name of [...asked.keys()]) {
        if (connected.includes(name) && configs[name] !== undefined) continue;
        asked.delete(name);
        moved = true;
      }
      await Promise.all(connected.map(async (name) => {
        const given = configs[name];
        if (given === undefined) return;
        const config = JSON.stringify(given);
        if (asked.get(name)?.config === config) return;
        // Held before the answer, so a refresh behind this one does not ask again.
        const mine: Asked = { config, skills: undefined };
        asked.set(name, mine);
        mine.skills = await ask(name, given);
        if (asked.get(name) === mine && mine.skills !== undefined) moved = true;
      }));
      if (closed) return false;
      return moved;
    },
    lay: (list) => {
      rows.clear();
      for (const row of list) {
        const name = str(row.name);
        const id = str(row.id);
        if (str(row.type) !== 'mcpServer' || name === undefined || id === undefined) continue;
        rows.set(name, id);
        const held = asked.get(name)?.skills;
        // Absent is a server nobody asked, or that could not be: an empty list
        // is one that was asked and serves none.
        if (held === undefined) { delete row.children; continue; }
        row.children = held.map((skill) => ({
          type: 'skill',
          id: idOf(id, skill.uri),
          uri: skill.uri,
          name: skill.name,
          ...(skill.description === '' ? {} : { description: line(skill.description, 1024) }),
          enabled: onFor(idOf(id, skill.uri)),
        }));
      }
      if (!closed) write();
    },
    toggle: (id, enabled) => {
      const known = [...asked].some(([server, one]) => {
        const row = rows.get(server);
        return row !== undefined && (one.skills ?? []).some((skill) => idOf(row, skill.uri) === id);
      });
      if (!known) return false;
      const mine = choices.get(options.session) ?? new Map<string, boolean>();
      choices.set(options.session, mine);
      mine.set(id, enabled);
      return true;
    },
    mine: (name) => name.startsWith(`${MCP_SKILLS_PLUGIN}:`),
    close: () => {
      closed = true;
      if (made !== undefined) rmSync(made, { recursive: true, force: true });
      made = undefined;
    },
  };
}
