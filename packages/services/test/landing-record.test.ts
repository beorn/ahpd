import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { FIELDS, LANDING_KEY, applyPatch, checkPatch, fromNative, nativeChanges, type ServiceRecord } from '../src/record.js';

/*
 * #39156 acceptance A: the landing is a field of the record, not only a key somebody writes into the machine's file.
 * The watch already reads `x-hh-landing`; without a field, a put refused it and a get dropped it, so the first real
 * mover on #38276 could not declare the link it is served from through the driver at all.
 */

const COMPOSE = `processes:
  site:
    command: bun run site.ts
    working_dir: /deploy/site/current
    x-hh-landing: /deploy/site/current
`;

const reread = (text: string, name: string): ServiceRecord | string =>
  fromNative(name, (parseDocument(text).toJS() as { processes: Record<string, unknown> }).processes[name]);

describe('the landing on a service record (#39156 A)', () => {
  it('is a field list answers, and a patch may set or clear it', () => {
    expect(FIELDS).toContain('landing');
    expect(checkPatch({ name: 'site', landing: '/deploy/site/current' })).toBeUndefined();
    expect(checkPatch({ name: 'site', landing: null })).toBeUndefined();
  });

  it('refuses a landing that is empty, blank or templated, by name', () => {
    expect(checkPatch({ name: 'site', landing: '' })).toEqual({ code: 'INVALID', message: 'landing must be a non-empty string' });
    expect(checkPatch({ name: 'site', landing: '   ' })).toEqual({ code: 'INVALID', message: 'landing must be a non-empty string' });
    expect(checkPatch({ name: 'site', landing: '/x/{{.A}}' })).toEqual({
      code: 'INVALID',
      message: 'landing holds "{{", which process-compose reads as a template',
    });
  });

  it('reads the native key back as the field', () => {
    expect(reread(COMPOSE, 'site')).toEqual({
      name: 'site', command: 'bun run site.ts', cwd: '/deploy/site/current', landing: '/deploy/site/current',
    });
    expect(reread('processes:\n  site:\n    command: bun run site.ts\n', 'site')).not.toHaveProperty('landing');
  });

  it('writes and takes off the native key, and leaves it alone when the field is unchanged', () => {
    const before = reread(COMPOSE, 'site') as ServiceRecord;
    const moved = applyPatch(before, { name: 'site', landing: '/deploy/site/releases/next' });
    expect(nativeChanges(before, moved)).toEqual([[[LANDING_KEY], '/deploy/site/releases/next']]);
    const kept = applyPatch(before, { name: 'site', command: 'bun run site.ts --port 8080' });
    expect(nativeChanges(before, kept).some(([path]) => path[0] === LANDING_KEY)).toBe(false);
    expect(nativeChanges(before, applyPatch(before, { name: 'site', landing: null }))).toEqual([[[LANDING_KEY], expect.anything()]]);
  });

  it('refuses a native key that is not a path rather than reading it as one', () => {
    expect(reread('processes:\n  site:\n    command: bun run site.ts\n    x-hh-landing: {to: elsewhere}\n', 'site'))
      .toBe('its x-hh-landing is not a path');
    expect(reread('processes:\n  site:\n    command: bun run site.ts\n    x-hh-landing: ""\n', 'site'))
      .toBe('its x-hh-landing is not a path');
  });
});
