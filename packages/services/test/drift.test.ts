import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ComposeMachine } from '../src/compose.js';
import { acknowledge, checkDrift, compareDrift, readKnown, type DriftFacts } from '../src/drift.js';

/*
 * #38277 slice 2: drift (@cto). Reported, never repaired: each difference
 * between what process-compose holds and what the files say, and each file
 * whose hash is not the one the driver wrote or acknowledged, is one alert
 * with its own `services-drift:` ref.
 */

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const facts = (over: Partial<DriftFacts> = {}): DriftFacts => ({
  machine: 'test-machine',
  running: [{ name: 'web', status: 'Running' }],
  defined: new Map([['web', '/m/local.yaml']]),
  hashes: new Map([['/m/local.yaml', { hash: sha('a') }]]),
  known: { '/m/local.yaml': sha('a') },
  ...over,
});

describe('compareDrift', () => {
  it('finds nothing when process-compose holds what the files define and every file is the one written', () => {
    expect(compareDrift(facts())).toEqual([]);
  });

  it('names a service the files define that process-compose does not hold, and one it holds that no file defines', () => {
    const alerts = compareDrift(facts({
      running: [{ name: 'web', status: 'Running' }, { name: 'ghost', status: 'Running' }],
      defined: new Map([['web', '/m/local.yaml'], ['cron', '/m/base.yaml']]),
    }));
    expect(alerts).toEqual([
      { level: 'warning', ref: 'services-drift:not-loaded:cron', text: 'cron is defined in /m/base.yaml but process-compose on test-machine does not hold it; it has not reloaded the files' },
      { level: 'warning', ref: 'services-drift:not-in-files:ghost', text: 'process-compose on test-machine holds ghost (Running), which no -f file defines; it was added in memory or its file changed under it' },
    ]);
  });

  it('names a file whose hash is not the one last written or acknowledged, and takes no view of a file it never knew', () => {
    const alerts = compareDrift(facts({
      hashes: new Map([['/m/local.yaml', { hash: sha('b') }], ['/m/base.yaml', { hash: sha('c') }]]),
    }));
    expect(alerts).toEqual([{
      level: 'warning',
      ref: 'services-drift:file:/m/local.yaml',
      text: `/m/local.yaml on test-machine changed outside the services driver: it is ${sha('b').slice(0, 12)}, last written or acknowledged as ${sha('a').slice(0, 12)}`,
    }]);
  });

  it('says what it could not read rather than comparing against nothing', () => {
    const alerts = compareDrift(facts({
      running: 'connect ENOENT /m/pc.sock',
      defined: '/m/local.yaml is not YAML: bad',
      hashes: new Map([['/m/local.yaml', { error: 'EACCES' }]]),
      known: '/m/drift.json is not JSON',
    }));
    expect(alerts.map((one) => [one.level, one.ref])).toEqual([
      ['error', 'services-drift:process-compose'],
      ['error', 'services-drift:files'],
      ['error', 'services-drift:state'],
      ['error', 'services-drift:file:/m/local.yaml'],
    ]);
    expect(alerts[0]!.text).toBe('cannot read what process-compose on test-machine runs: connect ENOENT /m/pc.sock');
  });
});

describe('checkDrift against files and a process-compose socket', () => {
  let dir: string;
  let server: Server;
  let held: string[];
  let machine: ComposeMachine;
  let stateFile: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ahpd-services-drift-'));
    writeFileSync(join(dir, 'base.yaml'), 'version: "0.5"\nprocesses:\n  shared:\n    command: sleep 1\n');
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n');
    writeFileSync(join(dir, 'token'), 'a-token-of-twenty-chars-or-more\n');
    held = ['shared', 'web'];
    server = createServer((req, res) => {
      const ok = req.url === '/processes' && req.headers['x-pc-token-key'] === 'a-token-of-twenty-chars-or-more';
      res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' })
        .end(JSON.stringify(ok ? { data: held.map((name) => ({ name, status: 'Running' })) } : { error: 'no' }));
    });
    const socket = join(dir, 'pc.sock');
    await new Promise<void>((done) => server.listen(socket, done));
    machine = {
      name: 'test-machine',
      configDir: dir,
      changeLog: join(dir, 'changes.jsonl'),
      backend: { kind: 'process-compose', files: [join(dir, 'base.yaml'), join(dir, 'local.yaml')], pc: { socket, tokenFile: join(dir, 'token') } },
    };
    stateFile = join(dir, 'services', 'drift.json');
  });
  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes the files as they are on the first check, then names a hand edit until it is acknowledged', async () => {
    expect(await checkDrift(machine, stateFile)).toEqual([]);
    expect(statSync(stateFile).mode & 0o777).toBe(0o600);
    expect(Object.keys(readKnown(stateFile)).sort()).toEqual(machine.backend.files.slice().sort());

    const local = join(dir, 'local.yaml');
    writeFileSync(local, 'processes:\n  web:\n    command: sleep 3\n');
    const edited = await checkDrift(machine, stateFile);
    expect(edited.map((one) => one.ref)).toEqual([`services-drift:file:${local}`]);

    acknowledge(stateFile, local, sha(readFileSync(local, 'utf8')));
    expect(await checkDrift(machine, stateFile)).toEqual([]);
  });

  it('names a service process-compose has not loaded, and one it holds that the files do not define', async () => {
    held = ['shared', 'extra'];
    const alerts = await checkDrift(machine, stateFile);
    expect(alerts.map((one) => one.ref)).toEqual(['services-drift:not-loaded:web', 'services-drift:not-in-files:extra']);
  });

  // #38277: process-compose holds a program with replicas: N as <name>-0 … <name>-(N-1) (observed on 1.122.0,
  // /hh/var/@dev6/38277/replicas-probe), so a replicated service read as not loaded and its replicas as unknown.
  it('takes a replicated service as its replicas, named the way process-compose names them, and still names a missing one', async () => {
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n    replicas: 2\n');
    held = ['shared', 'web-0', 'web-1'];
    expect(await checkDrift(machine, stateFile)).toEqual([]);
    held = ['shared', 'web-0'];
    expect((await checkDrift(machine, stateFile)).map((one) => one.ref)).toEqual(['services-drift:not-loaded:web-1']);
  });

  // process-compose 1.122.0 holds an explicit replicas: 1 under the plain name, not <name>-0 (probed
  // /hh/var/@dev6/38277/replicas-probe: `one` with replicas: 1, `two-0`/`two-1` with replicas: 2), so a service
  // declared with replicas: 1 must not false-alert.
  it('takes a service with replicas: 1 under its plain name, as process-compose holds it', async () => {
    writeFileSync(join(dir, 'local.yaml'), 'processes:\n  web:\n    command: sleep 2\n    replicas: 1\n');
    held = ['shared', 'web'];
    expect(await checkDrift(machine, stateFile)).toEqual([]);
    held = ['shared', 'web-0'];
    expect((await checkDrift(machine, stateFile)).map((one) => one.ref)).toEqual([
      'services-drift:not-loaded:web',
      'services-drift:not-in-files:web-0',
    ]);
  });

  it('says process-compose cannot be read, by its answer, and still compares the files', async () => {
    machine = { ...machine, backend: { ...machine.backend, pc: { socket: machine.backend.pc.socket, tokenFile: join(dir, 'missing-token') } } };
    await checkDrift(machine, stateFile);
    writeFileSync(join(dir, 'base.yaml'), 'version: "0.5"\nprocesses: {}\n');
    const alerts = await checkDrift(machine, stateFile);
    expect(alerts.map((one) => one.ref)).toEqual(['services-drift:process-compose', `services-drift:file:${join(dir, 'base.yaml')}`]);
    expect(alerts[0]!.text).toContain(`cannot read process-compose's token file ${join(dir, 'missing-token')}`);
  });
});
