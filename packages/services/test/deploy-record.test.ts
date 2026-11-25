import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { DEPLOY_KEY, checkPatch, fromNative, nativeChanges, type ServiceRecord } from '../src/record.js';
import { editEntry } from '../src/splice.js';

/*
 * #38549: the deploy declaration is the service's own record, under `x-hh-deploy`.
 * @cto 2026-11-25 measured that process-compose 1.122.0 refuses a bare `deploy:`
 * key on a process and accepts an `x-` one; the last block here proves that with
 * the real binary, so an upgrade that starts refusing `x-` keys fails this test
 * rather than a live deploy.
 */

const declaration = {
  repo: '/srv/repo',
  ref: 'main',
  migrations: 'expand-only' as const,
  keep: 3,
  build: { command: 'bun', args: ['run', 'build'], timeoutMs: 60_000 },
  before_switch: { command: 'bun', args: ['run', 'migrate'], env: { TOKEN: { $secret: 'prod:token' } } },
  check: { command: 'bun', args: ['run', 'check'], cwd: '/srv/check' },
};

const COMPOSE = `processes:
  hello:
    command: bun run hello
    availability:
      restart: always
  bye:
    command: "true"
`;

describe('the deploy declaration on a service record (#38549)', () => {
  it('accepts the declaration a machine writes, and keeps every step field', () => {
    expect(checkPatch({ name: 'hello', deploy: declaration })).toBeUndefined();
  });

  it('refuses each bad field by name, never by silence', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...declaration, repo: '' }, 'repo'],
      [{ ...declaration, migrations: 'destructive' }, 'migrations'],
      [{ ...declaration, keep: 1 }, 'keep'],
      [{ ...declaration, deploy: 'x' } as unknown, 'not an object'],
      [{ ...declaration, unknown: 1 }, 'unknown'],
      [{ ...declaration, build: { command: 'bun', args: 'run build' } }, 'args'],
      [{ ...declaration, build: { command: 'bun', args: ['--x'], env: { TOKEN: 'plain' } } }, 'secret reference'],
      [{ ...declaration, check: { command: '' } }, 'command'],
    ];
    for (const [deploy, said] of cases) {
      const why = checkPatch({ name: 'hello', deploy: (deploy as { deploy?: unknown }).deploy ?? deploy });
      expect(why, String(said)).toBeDefined();
      expect(why?.message, String(said)).toContain(said);
    }
  });

  it('reads the declaration back from x-hh-deploy, and writes it there', () => {
    const record = fromNative('hello', {
      command: 'bun run hello',
      [DEPLOY_KEY]: declaration,
    });
    expect(typeof record).not.toBe('string');
    expect((record as ServiceRecord).deploy).toEqual(declaration);

    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'hello', nativeChanges(undefined, { ...(record as ServiceRecord), name: 'hello' }));
    expect(text).toContain(`${DEPLOY_KEY}:`);
    expect(text).toContain('migrations: expand-only');
    expect(text).toContain('- run');
    expect(text).toContain('$secret: prod:token');
    // The other entry is untouched, byte for byte.
    expect(text).toContain('  bye:\n    command: "true"\n');
    // And it reads back through the same parse the driver uses.
    const reread = fromNative('hello', (parseDocument(text).toJS() as { processes: Record<string, unknown> }).processes['hello']);
    expect(reread).toMatchObject({ deploy: declaration });
  });

  it('refuses a declaration it cannot read faithfully, so the entry is read-only rather than misread', () => {
    expect(fromNative('hello', { command: 'bun run hello', [DEPLOY_KEY]: { repo: '/srv/repo' } })).toContain('ref');
    expect(fromNative('hello', { command: 'bun run hello', [DEPLOY_KEY]: { repo: '/srv/repo', ref: 'main', nope: 1 } })).toContain('nope');
  });
});

/** process-compose as the test's own proof: the real binary, if this machine can name it. */
const processCompose = (): string | undefined => {
  const fromPath = spawnSync('sh', ['-c', 'command -v process-compose'], { encoding: 'utf8' });
  if (fromPath.status === 0 && fromPath.stdout.trim() !== '') return fromPath.stdout.trim();
  if (process.env['PROCESS_COMPOSE_BIN'] !== undefined) return process.env['PROCESS_COMPOSE_BIN'];
  // The nix store on the machines that run this suite: one directory read, and no assumption about the hash.
  const store = '/nix/store';
  if (!existsSync(store)) return undefined;
  const found = readdirSync(store).filter((name) => /-process-compose-\d/u.test(name));
  const binary = found.map((name) => join(store, name, 'bin', 'process-compose')).find((path) => existsSync(path));
  return binary;
};

describe('process-compose accepts the extension key and refuses a bare one (@cto 2026-11-25)', () => {
  const binary = processCompose();

  const validate = (text: string): { status: number | null; output: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-deploy-key-'));
    const file = join(dir, 'pc.yaml');
    writeFileSync(file, text);
    const ran = spawnSync(binary!, ['-f', file, '--dry-run'], { encoding: 'utf8', timeout: 60_000 });
    return { status: ran.status, output: `${ran.stdout}${ran.stderr}` };
  };

  it('validates x-hh-deploy and refuses a bare deploy key', () => {
    if (binary === undefined) {
      throw new Error('process-compose was not found: set PROCESS_COMPOSE_BIN or put it on PATH. This test is the only thing standing between a process-compose upgrade and a live deploy that cannot read its declaration.');
    }
    const accepted = validate(`processes:
  hello:
    command: bun run hello
    ${DEPLOY_KEY}:
      repo: /srv/repo
      ref: main
`);
    expect(accepted.status, accepted.output).toBe(0);

    const refused = validate(`processes:
  hello:
    command: bun run hello
    deploy:
      repo: /srv/repo
      ref: main
`);
    expect(refused.status, refused.output).not.toBe(0);
    expect(refused.output).toMatch(/deploy/u);
  }, 120_000);
});
