/*
 * The record of what a start could not load.
 *
 * The point of the file is that its presence means the fold now running is
 * missing a plugin, so the cases are about which alerts count, what is removed
 * when everything loads, and that a file holding something else is refused
 * rather than read as "nothing failed".
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PLUGIN_FAILURES_FILE,
  pluginFailuresOf,
  pluginFailuresPath,
  readPluginFailures,
  writePluginFailures,
} from '../src/pluginfailures.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-plugin-failures-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pluginFailuresOf', () => {
  it('keeps the last error of every plugin that did not load, sorted by id', () => {
    expect(pluginFailuresOf({
      zebra: [{ level: 'warning', text: 'plugin zebra: an option was passed through' }, { level: 'error', text: 'plugin zebra failed: threw' }],
      alpha: [{ level: 'error', text: 'plugin alpha failed: no such module' }],
      clean: [{ level: 'warning', text: 'plugin clean: an icon was dropped' }],
    })).toEqual([
      { plugin: 'alpha', line: 'plugin alpha failed: no such module' },
      { plugin: 'zebra', line: 'plugin zebra failed: threw' },
    ]);
  });

  it('never repeats a keyed credential a line echoes back', () => {
    // What a plugin throws may quote what it was configured with, and the
    // record, the doctor line and a page are all read by people.
    expect(pluginFailuresOf({
      hightea: [{ level: 'error', text: 'the pipe refused token=sk-live-8d3f9a2c7b41e6d0 with Authorization: Bearer tk-live-4' }],
    })).toEqual([{
      plugin: 'hightea',
      line: 'the pipe refused token=<redacted> with Authorization: Bearer <redacted>',
    }]);
  });

  it('is empty when every row holds only warnings', () => {
    expect(pluginFailuresOf({ clean: [{ level: 'warning', text: 'plugin clean: an icon was dropped' }] })).toEqual([]);
  });
});

describe('writePluginFailures', () => {
  it('writes the time and the failure, owner-only, and reads back', () => {
    const at = new Date('2026-11-25T19:30:00.000Z');
    expect(writePluginFailures(root, { hightea: [{ level: 'error', text: 'plugin hightea failed in 2 ms: THROWER: x' }] }, at)).toBeUndefined();
    const file = pluginFailuresPath(root);
    expect(file).toBe(join(root, PLUGIN_FAILURES_FILE));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readPluginFailures(root)).toEqual({
      at: '2026-11-25T19:30:00.000Z',
      failures: [{ plugin: 'hightea', line: 'plugin hightea failed in 2 ms: THROWER: x' }],
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ at: '2026-11-25T19:30:00.000Z' });
  });

  it('removes the record when a later fold loads everything', () => {
    writePluginFailures(root, { hightea: [{ level: 'error', text: 'plugin hightea failed: x' }] });
    expect(existsSync(pluginFailuresPath(root))).toBe(true);
    expect(writePluginFailures(root, { hightea: [{ level: 'warning', text: 'plugin hightea: a warning' }] })).toBeUndefined();
    expect(existsSync(pluginFailuresPath(root))).toBe(false);
    expect(readPluginFailures(root)).toBeUndefined();
  });

  it('removing a record that is not there is not a failure', () => {
    expect(writePluginFailures(root, {})).toBeUndefined();
  });
});

describe('readPluginFailures', () => {
  it('answers nothing when no start has left a record', () => {
    expect(readPluginFailures(root)).toBeUndefined();
  });

  it('redacts a credential a record written before this build holds', () => {
    // A host that updates keeps the record its last start left: what every
    // reader prints from it is still cleared before it is printed.
    writeFileSync(pluginFailuresPath(root), `${JSON.stringify({
      at: '2026-11-25T19:30:00.000Z',
      failures: [{ plugin: 'hightea', line: 'the pipe refused: Authorization: Bearer sk-live-8d3f9a2c7b41e6d0' }],
    })}\n`);

    expect(readPluginFailures(root)).toEqual({
      at: '2026-11-25T19:30:00.000Z',
      failures: [{ plugin: 'hightea', line: 'the pipe refused: Authorization: Bearer <redacted>' }],
    });
  });

  it('refuses a file that is not a record, rather than reading it as no failure', () => {
    writeFileSync(pluginFailuresPath(root), '{"at": 3, "failures": []}\n');
    expect(() => readPluginFailures(root)).toThrow(/is not a plugin failure record/u);
    writeFileSync(pluginFailuresPath(root), '{"at": "2026-11-25T19:30:00.000Z", "failures": [{"plugin": "x"}]}\n');
    expect(() => readPluginFailures(root)).toThrow(/is not a plugin failure record|not a plugin and a line/u);
    writeFileSync(pluginFailuresPath(root), 'not json');
    expect(() => readPluginFailures(root)).toThrow(/is not a plugin failure record/u);
  });
});
