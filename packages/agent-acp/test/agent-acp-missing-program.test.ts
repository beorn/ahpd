import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { acpAgent } from '../src/index.js';

/* What an ACP agent says of its program: the name it cannot find, or nothing. */

const windows = process.platform === 'win32';
const file = windows ? 'tool-acp.cmd' : 'tool-acp';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-missing-'));
  writeFileSync(join(dir, file), '');
  chmodSync(join(dir, file), 0o755);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const asked = (command: string, env?: Record<string, string>): string | undefined =>
  acpAgent({ command, ...(env === undefined ? {} : { env }) }).missingProgram?.();

it('names a command that is not on the PATH', () => {
  expect(asked('ahpd-no-such-program-acp')).toBe('ahpd-no-such-program-acp');
});

it('finds a command on the PATH its record sets, and not on another', () => {
  expect(asked('tool-acp', { PATH: dir })).toBeUndefined();
  expect(asked('tool-acp', { PATH: join(dir, 'none') })).toBe('tool-acp');
});

it('reads an absolute command as the file it names', () => {
  expect(asked(join(dir, file))).toBeUndefined();
  expect(asked(join(dir, 'none'))).toBe(join(dir, 'none'));
});

it('says nothing of a relative command, which is read against a session\'s folder', () => {
  expect(asked('./none/tool-acp')).toBeUndefined();
});

it('says its program is missing though it declares what a machine needs', () => {
  expect(acpAgent({ command: 'ahpd-no-such-program-acp', machine: { part: 'amp' } as never }).missingProgram?.()).toBe('ahpd-no-such-program-acp');
});
