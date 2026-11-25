import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, USAGE } from '../src/cli.js';
import type { InstallIo } from '../src/install-run.js';

const pinsFile = (overrides: Record<string, unknown> = {}) => {
  const file = join(mkdtempSync(join(tmpdir(), 'ahpd-cli-')), 'pins.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: '0.15.0-rc.4',
      platform: 'linux',
      pins: {
        runtime: { version: '1.3.13', source: 'https://bun.invalid/1', checksum: 'sha256:' + 'a'.repeat(64) },
        ahpd: { version: '0.15.0-rc.4', source: 'https://reg.invalid/a.tgz', checksum: 'sha256:' + 'b'.repeat(64) },
        hostPlugin: { version: '0.1.0', source: 'https://reg.invalid/h.tgz', checksum: 'sha256:' + 'c'.repeat(64) },
        supervisor: { version: '1.34.1', source: 'https://rel.invalid/s.gz', checksum: 'sha256:' + 'd'.repeat(64) },
      },
      ...overrides,
    }),
  );
  return file;
};

const collect = () => {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };
};

const noopIo = () =>
  ({}) as InstallIo;

describe('ahpd-host-install, the command the bootstrap runs (#38280)', () => {
  // @level l3 @consumer the plan is what a customer reads before anything is created, from the pins the script ships.
  it('prints the plan from a pins file and touches nothing', async () => {
    const sink = collect();
    const code = await run(['--plan', '--pins', pinsFile()], noopIo(), sink.out, sink.err);
    expect(code).toBe(0);
    const text = sink.lines.join('\n');
    expect(text).toContain('ahpd 0.15.0-rc.4 on linux');
    expect(text).toContain('fetch runtime 1.3.13 from https://bun.invalid/1');
    expect(text).toContain('uninstall removes');
  });

  // @level l3 @consumer usage and bad input are refusals with a non-zero code, never a silent success.
  it('refuses a missing or unknown option, and a pins file it cannot read', async () => {
    const sink = collect();
    expect(await run([], noopIo(), sink.out, sink.err)).toBe(0);
    expect(sink.lines[0]).toBe(USAGE);

    const missing = collect();
    expect(await run(['--plan'], noopIo(), missing.out, missing.err)).toBe(2);
    expect(missing.lines.join('\n')).toContain('--pins is required');

    const unknown = collect();
    expect(await run(['--plan', '--pins', pinsFile(), '--soak'], noopIo(), unknown.out, unknown.err)).toBe(2);
    expect(unknown.lines.join('\n')).toContain('--soak is not an option');

    const unreadable = collect();
    expect(await run(['--plan', '--pins', '/nonexistent/pins.json'], noopIo(), unreadable.out, unreadable.err)).toBe(2);
    expect(unreadable.lines.join('\n')).toContain('/nonexistent/pins.json');
  });

  // @level l3 @consumer an unpinned download is refused by the same checks the plan uses, with exit 1.
  it('refuses a download with no checksum and says which one', async () => {
    const file = pinsFile({
      pins: {
        runtime: { version: '1.3.13', source: 'https://bun.invalid/1', checksum: null },
        ahpd: { version: '0.15.0-rc.4', source: 'https://reg.invalid/a.tgz', checksum: 'sha256:' + 'b'.repeat(64) },
        hostPlugin: { version: '0.1.0', source: 'https://reg.invalid/h.tgz', checksum: 'sha256:' + 'c'.repeat(64) },
        supervisor: { version: '1.34.1', source: 'https://rel.invalid/s.gz', checksum: 'sha256:' + 'd'.repeat(64) },
      },
    });
    const sink = collect();
    expect(await run(['--plan', '--pins', file], noopIo(), sink.out, sink.err)).toBe(1);
    expect(sink.lines.join('\n')).toContain('runtime has no published checksum');
  });
});
