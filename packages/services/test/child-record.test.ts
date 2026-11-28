import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { FIELDS, applyPatch, checkPatch, fromNative, nativeChanges, same, type ServiceRecord } from '../src/record.js';
import { editEntry } from '../src/splice.js';

/*
 * #39156 B: an entry names the child identity it runs under, and the wrapper carries it as `--child <name>`. The name
 * is the one the published service declaration lists; hab mints the token from that declaration, so the entry can ask
 * for nothing the declaration does not publish. A child field that reads back differently from what was written would
 * make every put refuse, so the round trip is part of the test.
 */

const COMPOSE = `processes:
  workmon:
    command: bun run workmon
  api:
    command: node api.js
`;

const reread = (text: string, name: string): ServiceRecord | string =>
  fromNative(name, (parseDocument(text).toJS() as { processes: Record<string, unknown> }).processes[name]);

describe('the child identity on a service record (#39156 B)', () => {
  it('is a field list answers, and a patch may set or clear it', () => {
    expect(FIELDS).toContain('child');
    expect(checkPatch({ name: 'workmon', child: 'workmon' })).toBeUndefined();
    expect(checkPatch({ name: 'workmon', child: null })).toBeUndefined();
  });

  it('refuses each bad child by name', () => {
    const cases: Array<[unknown, string]> = [
      [7, 'child must be the name the service declaration lists'],
      ['', 'child must be a non-empty string'],
      ['not a name', 'child must be the name the service declaration lists'],
      ['-leading', 'child must be the name the service declaration lists'],
      ['a{{b}}', 'child holds "{{"'],
    ];
    for (const [child, said] of cases) {
      const why = checkPatch({ name: 'workmon', child });
      expect(why?.code, said).toBe('INVALID');
      expect(why?.message, said).toContain(said);
    }
  });

  it('carries the child in the wrapper, reads it back, and leaves the other entry byte for byte', () => {
    const before = fromNative('workmon', { command: 'bun run workmon' }) as ServiceRecord;
    expect(before.child).toBeUndefined();
    const after = applyPatch(before, { name: 'workmon', child: 'workmon' });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'workmon', nativeChanges(before, after));
    expect(text).toContain('ahpd secrets exec workmon --child workmon -- ');
    expect(text).toContain('  api:\n    command: node api.js\n');
    const back = reread(text, 'workmon');
    expect(back).toMatchObject({ command: 'bun run workmon', child: 'workmon' });
    expect(same(back, after)).toBe(true);
  });

  it('puts --child after the secret references, before the command', () => {
    const after = applyPatch(undefined, {
      name: 'workmon', command: 'bun run workmon', env: { TOKEN: { $secret: 'host:token' } }, child: 'workmon',
    });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'workmon', nativeChanges(undefined, after));
    expect(text).toContain('--env TOKEN=host:token --child workmon -- ');
    expect(same(reread(text, 'workmon'), after)).toBe(true);
  });

  it('drops the wrapper when the child is taken off and nothing else needs it', () => {
    const before = fromNative('workmon', { command: 'bun run workmon' }) as ServiceRecord;
    const withChild = applyPatch(before, { name: 'workmon', child: 'workmon' });
    const text = editEntry(COMPOSE, parseDocument(COMPOSE), 'workmon', nativeChanges(before, withChild));
    const read = reread(text, 'workmon') as ServiceRecord;
    const cleared = applyPatch(read, { name: 'workmon', child: null });
    const back = editEntry(text, parseDocument(text), 'workmon', nativeChanges(read, cleared));
    expect(back).toContain('    command: bun run workmon\n');
    expect(reread(back, 'workmon')).toMatchObject({ command: 'bun run workmon' });
  });

  it('reads a wrapper that is not the shape the driver writes as an entry it does not edit', () => {
    expect(fromNative('workmon', { command: "ahpd secrets exec other --child workmon -- 'bun run'" }))
      .toBe('its secrets wrapper names the service other');
    expect(fromNative('workmon', { command: "ahpd secrets exec workmon --child not a name -- 'bun run'" }))
      .toBe('its command uses the secrets wrapper in a form the driver does not write');
  });
});
