import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { FIELDS, SOURCE_KEY, applyPatch, checkPatch, fromNative, nativeChanges, type ServiceRecord } from '../src/record.js';
import { editEntry } from '../src/splice.js';

/*
 * #38278 (@cto b6ff041e): a service says who put it on the machine, as
 * `source: {kind, id}`, written natively as `x-hh-source` beside `x-hh-deploy`.
 * An entry without one is not ours to prune. The last block runs the real
 * process-compose, so an upgrade that refuses the key fails here, not on a host.
 */

const COMPOSE = `processes:
  hello:
    command: bun run hello
  bye:
    command: "true"
`;

const reread = (text: string, name: string): ServiceRecord | string =>
  fromNative(name, (parseDocument(text).toJS() as { processes: Record<string, unknown> }).processes[name]);

describe('the source on a service record (#38278)', () => {
  it('is a field list answers, and a patch may set it', () => {
    expect(FIELDS).toContain('source');
    for (const kind of ['file', 'program', 'agent', 'ci'] as const) {
      expect(checkPatch({ name: 'hello', source: { kind, id: 'hh.hab.tsx#terminfo-site' } }), kind).toBeUndefined();
    }
    expect(checkPatch({ name: 'hello', source: null })).toBeUndefined();
  });

  it('refuses each bad source by name', () => {
    const cases: Array<[unknown, string]> = [
      [{ kind: 'human', id: 'x' }, 'kind must be one of file, program, agent, ci'],
      [{ kind: 'file' }, 'id is a non-empty string'],
      [{ kind: 'file', id: '  ' }, 'id is a non-empty string'],
      [{ kind: 'file', id: 'a{{b}}' }, 'id holds "{{"'],
      [{ kind: 'file', id: 'x', owner: 'me' }, 'owner is not a source field'],
      ['file:x', 'it is an object { kind, id }'],
    ];
    for (const [source, said] of cases) {
      const why = checkPatch({ name: 'hello', source });
      expect(why?.code, said).toBe('INVALID');
      expect(why?.message, said).toContain(`source: ${said}`);
    }
  });

  it('writes x-hh-source, reads it back, and leaves the other entry byte for byte', () => {
    const before = fromNative('hello', { command: 'bun run hello' }) as ServiceRecord;
    expect(before.source).toBeUndefined();
    const after = applyPatch(before, { name: 'hello', source: { kind: 'ci', id: 'deploy-site' } });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'hello', nativeChanges(before, after));
    expect(text).toContain(`${SOURCE_KEY}:`);
    expect(text).toContain('  bye:\n    command: "true"\n');
    expect(reread(text, 'hello')).toMatchObject({ source: { kind: 'ci', id: 'deploy-site' } });
  });

  it('keeps the source across a patch that leaves it out, and clears it only on source: null', () => {
    const owned = fromNative('hello', { command: 'bun run hello', [SOURCE_KEY]: { kind: 'agent', id: '@dev/8' } }) as ServiceRecord;
    expect(owned.source).toEqual({ kind: 'agent', id: '@dev/8' });
    const text = `processes:\n  hello:\n    command: bun run hello\n    ${SOURCE_KEY}:\n      kind: agent\n      id: "@dev/8"\n`;

    const moved = applyPatch(owned, { name: 'hello', command: 'bun run hi' });
    const kept = editEntry(text, parseDocument(text), 'hello', nativeChanges(owned, moved));
    expect(reread(kept, 'hello')).toMatchObject({ command: 'bun run hi', source: { kind: 'agent', id: '@dev/8' } });

    const cleared = applyPatch(owned, { name: 'hello', source: null });
    const gone = editEntry(text, parseDocument(text), 'hello', nativeChanges(owned, cleared));
    expect(gone).not.toContain(SOURCE_KEY);
    expect((reread(gone, 'hello') as ServiceRecord).source).toBeUndefined();
  });

  it('refuses an x-hh-source it cannot read faithfully, so the entry is read-only rather than misread', () => {
    expect(fromNative('hello', { command: 'x', [SOURCE_KEY]: { kind: 'robot', id: 'x' } })).toContain(`its ${SOURCE_KEY} is not a source the driver knows`);
    expect(fromNative('hello', { command: 'x', [SOURCE_KEY]: { kind: 'file' } })).toContain('id');
  });
});

/** process-compose as the test's own proof: the real binary, if this machine can name it. */
const processCompose = (): string | undefined => {
  const fromPath = spawnSync('sh', ['-c', 'command -v process-compose'], { encoding: 'utf8' });
  if (fromPath.status === 0 && fromPath.stdout.trim() !== '') return fromPath.stdout.trim();
  if (process.env['PROCESS_COMPOSE_BIN'] !== undefined) return process.env['PROCESS_COMPOSE_BIN'];
  const store = '/nix/store';
  if (!existsSync(store)) return undefined;
  const found = readdirSync(store).filter((name) => /-process-compose-\d/u.test(name));
  return found.map((name) => join(store, name, 'bin', 'process-compose')).find((path) => existsSync(path));
};

describe('process-compose accepts x-hh-source (@cto b6ff041e)', () => {
  it('validates an entry carrying x-hh-source', () => {
    const binary = processCompose();
    if (binary === undefined) {
      throw new Error('process-compose was not found: set PROCESS_COMPOSE_BIN or put it on PATH. This test is what stands between a process-compose upgrade and a host that cannot read its services.');
    }
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-source-key-'));
    const file = join(dir, 'pc.yaml');
    writeFileSync(file, `processes:\n  hello:\n    command: bun run hello\n    ${SOURCE_KEY}:\n      kind: file\n      id: hh.hab.tsx\n`);
    const ran = spawnSync(binary, ['-f', file, '--dry-run'], { encoding: 'utf8', timeout: 60_000 });
    expect(ran.status, `${ran.stdout}${ran.stderr}`).toBe(0);
  }, 120_000);
});
