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

/*
 * #38276 (@cto deede311): one restarter per service per promotion. The landing watch restarts a resident whose
 * landing moved, so a deploy `check` that restarts would be a second restarter — refused by name, unless the check
 * says it only verifies. A deploy with no check step restarts nothing and is allowed.
 */
describe('a landing and a deploying check on one entry (#38276)', () => {
  it('refuses by name, and accepts the same entry once the check says verify_only', () => {
    const withRestartingCheck = `processes:
  site:
    command: bun run site.ts
    x-hh-landing: /deploy/site/current
    x-hh-deploy:
      repo: /hh/dev
      ref: main
      check:
        command: /usr/bin/bash
        args: ['-c', 'curl -sf http://127.0.0.1:4173/build.json']
`;
    expect(reread(withRestartingCheck, 'site')).toBe(
      '"site" declares both x-hh-landing and an x-hh-deploy whose check restarts: the landing watch is the single restarter on process-compose, so the deploy\'s check must say verify_only: true, or the entry drops one of the two (one restarter per service per promotion, #38276)',
    );

    const verifyOnly = withRestartingCheck.replace('        args:', '        verify_only: true\n        args:');
    const read = reread(verifyOnly, 'site');
    expect(read).not.toBeTypeOf('string');
    expect((read as ServiceRecord).landing).toBe('/deploy/site/current');
    expect((read as ServiceRecord).deploy?.check?.verifyOnly).toBe(true);

    const noCheck = `processes:
  site:
    command: bun run site.ts
    x-hh-landing: /deploy/site/current
    x-hh-deploy:
      repo: /hh/dev
      ref: main
`;
    expect(typeof reread(noCheck, 'site')).not.toBe('string');
  });

  it('refuses verify_only anywhere but a check, because only a check can be told not to restart', () => {
    const onBuild = `processes:
  site:
    command: bun run site.ts
    x-hh-deploy:
      repo: /hh/dev
      ref: main
      build:
        command: /usr/bin/bash
        verify_only: true
`;
    expect(reread(onBuild, 'site')).toBe('its x-hh-deploy is not a declaration the driver knows: build.verify_only is not a step field; the fields are command, args, cwd, env, timeoutMs');
  });
});

/*
 * #38276: a resident that speaks on the wire needs one non-secret path at start. It is a named exception, not a
 * permission: only the names on PLAIN_ENV may be written plainly, and everything else stays a secret reference.
 */
import { PLAIN_ENV, nativeCommand } from '../src/record.js';

describe('a plain env value on a service record (#38276)', () => {
  it('writes the allowed name on the wrapper line, and reads it back', () => {
    expect(PLAIN_ENV).toContain('TRIBE_SOCKET');
    expect(checkPatch({ name: 'yrd', env: { TRIBE_SOCKET: { plain: '/hh/main.hab/run/tribe.sock' } } })).toBeUndefined();
    const native = nativeCommand('yrd', 'bun yrd.ts', { TRIBE_SOCKET: { plain: '/hh/main.hab/run/tribe.sock' } });
    expect(native).toBe("ahpd secrets exec yrd --set TRIBE_SOCKET=/hh/main.hab/run/tribe.sock -- 'bun yrd.ts'");
    expect(fromNative('yrd', { command: native })).toEqual({
      name: 'yrd', command: 'bun yrd.ts', env: { TRIBE_SOCKET: { plain: '/hh/main.hab/run/tribe.sock' } },
    });
  });

  it('refuses a plain value on any other name, by name and with the list', () => {
    expect(checkPatch({ name: 'yrd', env: { AWS_SECRET_ACCESS_KEY: { plain: 'oops' } } })).toEqual({
      code: 'PLAIN_ENV_VALUE',
      message: 'env AWS_SECRET_ACCESS_KEY may not be a plain value: only TRIBE_SOCKET may be written plainly, and every other name must be {"$secret":"<scope>:<name>"}',
    });
    expect(checkPatch({ name: 'yrd', env: { TRIBE_SOCKET: { plain: '/a b' } } }))
      .toEqual({ code: 'INVALID', message: 'env TRIBE_SOCKET: plain holds a space or a quote, which the wrapper\'s line cannot carry' });
  });

  it('reads a hand-written plain set back, and refuses one the list does not name', () => {
    expect(fromNative('yrd', { command: "ahpd secrets exec yrd --set TRIBE_SOCKET=/s -- 'bun yrd.ts'" })).toEqual({
      name: 'yrd', command: 'bun yrd.ts', env: { TRIBE_SOCKET: { plain: '/s' } },
    });
    expect(fromNative('yrd', { command: "ahpd secrets exec yrd --set HAB_ID_TOKEN=x -- 'bun yrd.ts'" }))
      .toBe('its secrets wrapper sets HAB_ID_TOKEN plainly, and only TRIBE_SOCKET may be written that way');
  });
});
