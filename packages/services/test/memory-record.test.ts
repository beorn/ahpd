import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { FIELDS, MEMORY_KEY, applyPatch, bytesOfSize, checkPatch, fromNative, nativeChanges, same, type ServiceRecord } from '../src/record.js';
import { editEntry } from '../src/splice.js';

/*
 * #39156 acceptance C: the per-run memory cap is a field of the record, not only a key somebody writes into the
 * machine's file, so a service moved onto process-compose through the driver can declare host-backup's 3G/4G pair.
 * The native key stays `x-hh-memory`, beside `x-hh-deploy`, and an entry no driver wrote still reads back as one.
 */

const COMPOSE = `processes:
  backup:
    command: bun run backup
  api:
    command: node api.js
`;

const reread = (text: string, name: string): ServiceRecord | string =>
  fromNative(name, (parseDocument(text).toJS() as { processes: Record<string, unknown> }).processes[name]);

describe('the memory cap on a service record (#39156 C)', () => {
  it('is a field list answers, and a patch may set or clear it', () => {
    expect(FIELDS).toContain('memory');
    expect(checkPatch({ name: 'backup', memory: { alarm: '3G', kill: '4G' } })).toBeUndefined();
    expect(checkPatch({ name: 'backup', memory: null })).toBeUndefined();
  });

  it('reads a size the way a person writes it', () => {
    expect(bytesOfSize('3G')).toBe(3 * 1024 ** 3);
    expect(bytesOfSize('512M')).toBe(512 * 1024 ** 2);
    expect(bytesOfSize('1024K')).toBe(1024 * 1024);
    expect(bytesOfSize('2GiB')).toBe(2 * 1024 ** 3);
    expect(bytesOfSize('4096')).toBe(4096);
    expect(bytesOfSize('lots')).toBeUndefined();
  });

  it('refuses each bad cap by name', () => {
    const cases: Array<[unknown, string]> = [
      ['3G', 'memory must be {alarm: "<size>", kill: "<size>"}'],
      [{ alarm: '3G' }, 'memory needs exactly alarm and kill'],
      [{ alarm: '3G', kill: '4G', warn: '2G' }, 'memory needs exactly alarm and kill'],
      [{ alarm: '3G', kill: 'lots' }, 'memory.kill is not a size such as 3G, 512M or 1024K'],
      [{ alarm: '', kill: '4G' }, 'memory.alarm must be a non-empty string'],
      [{ alarm: '3{{G}}', kill: '4G' }, 'memory.alarm holds "{{"'],
    ];
    for (const [memory, said] of cases) {
      const why = checkPatch({ name: 'backup', memory });
      expect(why?.code, said).toBe('INVALID');
      expect(why?.message, said).toContain(said);
    }
  });

  it('writes x-hh-memory, reads it back, and leaves the other entry byte for byte', () => {
    const before = fromNative('backup', { command: 'bun run backup' }) as ServiceRecord;
    expect(before.memory).toBeUndefined();
    const after = applyPatch(before, { name: 'backup', memory: { alarm: '3G', kill: '4G' } });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'backup', nativeChanges(before, after));
    expect(text).toContain(`${MEMORY_KEY}:`);
    expect(text).toContain('  api:\n    command: node api.js\n');
    const back = reread(text, 'backup');
    expect(back).toMatchObject({ memory: { alarm: '3G', kill: '4G' } });
    expect(same(back, after)).toBe(true);
  });

  it('clears the key when the field is taken off', () => {
    const before = fromNative('backup', { command: 'bun run backup', [MEMORY_KEY]: { alarm: '3G', kill: '4G' } }) as ServiceRecord;
    const after = applyPatch(before, { name: 'backup', memory: null });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'backup', nativeChanges(before, after));
    expect(text).not.toContain(MEMORY_KEY);
    expect(reread(text, 'backup')).toMatchObject({ name: 'backup' });
  });

  it('reads a cap it cannot understand as an entry the driver does not edit', () => {
    expect(fromNative('backup', { command: 'bun run backup', [MEMORY_KEY]: { alarm: '3G', kill: 'lots' } }))
      .toBe(`its ${MEMORY_KEY} alarm or kill is not a size`);
    expect(fromNative('backup', { command: 'bun run backup', [MEMORY_KEY]: '3G' }))
      .toBe(`its ${MEMORY_KEY} is not a mapping`);
  });
});
