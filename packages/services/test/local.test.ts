import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listServices } from '../src/compose.js';
import { localServices } from '../src/local.js';
import { servicesChannel, servicesState } from '../src/channel.js';
import { machineOf } from '../src/plugin.js';
import { REMOTE_COMMANDS_OFF } from '../src/switches.js';

/*
 * @cto 876bcedd (a): a person at the machine may add a raw command whatever
 * allowRemoteCommands says (5d3277bd); the daemon's methods, which cannot see
 * the transport, may not. Same machine, same switch, two answers.
 */

let dir: string;
let local: string;
let server: Server;
let socket: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-services-local-'));
  local = join(dir, 'local.yaml');
  writeFileSync(local, 'processes:\n  web:\n    command: one\n');
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"name":"ok"}'); });
  socket = join(dir, 'pc.sock');
  await new Promise<void>((done) => server.listen(socket, done));
  // The switch is off: the file says nothing about it.
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    port: 9187,
    plugins: [
      { source: '/opt/ahpd/node_modules/@ahpd/agent-acp' },
      { source: '/opt/ahpd/node_modules/@hallohuman/hightea-services', options: { files: [local], socket } },
    ],
  }));
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

const version = (): string => {
  const listing = listServices({ name: 'm', files: [local], configDir: dir, changeLog: join(dir, 'services', 'changes.jsonl'), pc: { socket } });
  if (!listing.ok) throw new Error(listing.message);
  return listing.ifVersion;
};

describe('localServices', () => {
  it('adds a raw command with allowRemoteCommands off, where the same put through the channel is refused', async () => {
    const read = machineOf(dir, { files: [local], socket });
    if (typeof read === 'string') throw new Error(read);
    mkdirSync(join(dir, 'services'), { recursive: true }); // what the plugin's apply makes at start
    const channel = servicesChannel({
      machine: read.machine, state: () => servicesState('m', listServices(read.machine), undefined, []), wrote: () => {}, changed: () => {},
    });
    await expect(channel.operations.run({ id: 'put' }, undefined, { service: { name: 'api', command: 'serve --port 8080' }, ifVersion: version() }, undefined, { client: 'c1', owner: 'plugin:hightea-pipe' }))
      .rejects.toMatchObject({ message: REMOTE_COMMANDS_OFF, data: { code: 'REMOTE_COMMANDS_OFF' } });
    expect(readFileSync(local, 'utf8')).not.toContain('api');

    const person = localServices(dir, 'bjorn');
    if (typeof person === 'string') throw new Error(person);
    expect(person.caller).toEqual({ principal: 'local:bjorn', remote: false });
    const answer = await person.put({ service: { name: 'api', command: 'serve --port 8080' }, ifVersion: version() });
    expect(answer).toMatchObject({ ok: true, changed: true });
    expect(readFileSync(local, 'utf8')).toContain('serve --port 8080');
    const log = readFileSync(join(dir, 'services', 'changes.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(log.at(-1)).toMatchObject({ principal: 'local:bjorn', op: 'put', name: 'api' });
    // The write is the driver's for drift, as a method's write is.
    const known = JSON.parse(readFileSync(join(dir, 'services', 'drift.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys((known as { files: Record<string, string> }).files)).toEqual([local]);
  });

  it('names why there is no local driver: no config, no services entry, two entries, bad options', () => {
    expect(localServices(join(dir, 'nowhere'))).toMatch(/cannot read .*config\.json/);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ plugins: [{ source: '/opt/x/@ahpd/agent-acp' }] }));
    expect(localServices(dir)).toMatch(/has no services plugin entry \(@hallohuman\/hightea-services\)/);
    const entry = { source: '/opt/ahpd/node_modules/@ahpd/services', options: { files: [local], socket } };
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ plugins: [entry, entry] }));
    expect(localServices(dir)).toMatch(/has 2 services plugin entries; keep one/);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ plugins: [{ source: entry.source, options: { files: ['relative.yaml'], socket } }] }));
    expect(localServices(dir)).toMatch(/"files" must list process-compose's -f files as absolute paths/);
  });
});

describe('localServices is for callers on the machine only (@cto ed929bd7)', () => {
  it('is reachable from no operation, read, plugin hook or pipe path: plugin.ts, channel.ts and drift.ts never import local.ts', () => {
    const src = join(import.meta.dirname, '..', 'src');
    for (const file of ['plugin.ts', 'channel.ts', 'drift.ts', 'compose.ts']) {
      const text = readFileSync(join(src, file), 'utf8');
      expect(text, file).not.toMatch(/from '\.\/local(\.js)?'|localServices/);
    }
  });
});
