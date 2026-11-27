import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { run, USAGE } from '../src/cli.js';
import { nodeInstallIo, type InstallIo } from '../src/install-run.js';
import { daemonArchive } from './daemon-archive.js';

const pinsFile = (overrides: Record<string, unknown> = {}) => {
  const file = join(mkdtempSync(join(tmpdir(), 'ahpd-cli-')), 'pins.json');
  writeFileSync(
    file,
    JSON.stringify({
      version: '0.15.0-rc.4',
      platform: 'linux',
      pins: {
        runtime: { version: '1.3.13', source: 'https://bun.invalid/1', checksum: 'sha256:' + 'a'.repeat(64) },
        ahpd: { version: '0.15.0-rc.4', source: 'https://reg.invalid/ahpd-0.15.0-rc.4-linux-x64.tar.gz', checksum: 'sha256:' + 'b'.repeat(64) },
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

/** The bytes the fake fetch answers, and a checksum that matches them, so an apply reaches its prune step. */
const bytesOf = (source: string) => `bytes:${source}`;
const honestChecksum = (source: string) => `sha256:${createHash('sha256').update(bytesOf(source)).digest('hex')}`;
const honestPinsFile = () => {
  const fetchable = (version: string, source: string) => ({ version, source, checksum: honestChecksum(source) });
  return pinsFile({
    pins: {
      runtime: fetchable('1.3.13', 'https://bun.invalid/1'),
      ahpd: fetchable('0.15.0-rc.4', 'https://reg.invalid/ahpd-0.15.0-rc.4-linux-x64.tar.gz'),
      hostPlugin: fetchable('0.1.0', 'https://reg.invalid/h.tgz'),
      supervisor: fetchable('1.34.1', 'https://rel.invalid/s.gz'),
    },
  });
};

/** A real archive in the shape the installer accepts, so the apply reaches its prune step for the right reason. */
const noopIo = () =>
  ({}) as InstallIo;

/**
 * npm links a bin through a symlink, so the entry point is reached by a different path than it lives at. Only
 * `bin.ts` is real here: the stub `cli.js` proves the bin calls `run` with the arguments and exits with its code.
 */
const binThroughSymlink = () => {
  const source = join(import.meta.dirname, '..', 'src');
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bin-'));
  const dist = join(root, 'dist');
  mkdirSync(dist);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  const { outputText } = ts.transpileModule(readFileSync(join(source, 'bin.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  writeFileSync(join(dist, 'bin.js'), outputText);
  writeFileSync(
    join(dist, 'cli.js'),
    'export const run = async (argv) => { console.log(`ran ${argv.join(" ")}`); return 7 };\n',
  );
  const link = join(root, 'ahpd-host-install');
  symlinkSync(join(dist, 'bin.js'), link);
  return { root, link };
};

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
        ahpd: { version: '0.15.0-rc.4', source: 'https://reg.invalid/ahpd-0.15.0-rc.4-linux-x64.tar.gz', checksum: 'sha256:' + 'b'.repeat(64) },
        hostPlugin: { version: '0.1.0', source: 'https://reg.invalid/h.tgz', checksum: 'sha256:' + 'c'.repeat(64) },
        supervisor: { version: '1.34.1', source: 'https://rel.invalid/s.gz', checksum: 'sha256:' + 'd'.repeat(64) },
      },
    });
    const sink = collect();
    expect(await run(['--plan', '--pins', file], noopIo(), sink.out, sink.err)).toBe(1);
    expect(sink.lines.join('\n')).toContain('runtime has no published checksum');
  });

  // @level l3 @consumer npm runs the bin through a symlink; it must call run with the arguments and keep its exit code.
  it('runs through a bin symlink, as npm installs it', () => {
    const { link } = binThroughSymlink();
    const result = spawnSync(process.execPath, [link, '--plan', '--pins', 'pins.json'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(7);
    expect(result.stdout).toContain('ran --plan --pins pins.json');
  });

  // @level l3 @consumer no HOME is a refusal, never an install into `/`; --home answers it.
  it('refuses an unset HOME and accepts --home', async () => {
    const saved = process.env['HOME'];
    try {
      delete process.env['HOME'];
      const sink = collect();
      expect(await run(['--plan', '--pins', pinsFile()], noopIo(), sink.out, sink.err)).toBe(2);
      expect(sink.lines.join('\n')).toContain('HOME is not set; pass --home');
    } finally {
      process.env['HOME'] = saved;
    }
    const sink = collect();
    expect(await run(['--plan', '--pins', pinsFile(), '--home', '/home/someone'], noopIo(), sink.out, sink.err)).toBe(0);
    expect(sink.lines.join('\n')).toContain('ahpd 0.15.0-rc.4 on linux');
  });

  // @level l3 @consumer one mode per run, and --purge belongs to --uninstall alone.
  it('refuses two modes at once, and --purge without --uninstall', async () => {
    const both = collect();
    expect(await run(['--plan', '--apply', '--pins', pinsFile()], noopIo(), both.out, both.err)).toBe(2);
    expect(both.lines.join('\n')).toContain('--plan and --apply cannot be combined');

    const uninstallToo = collect();
    expect(await run(['--apply', '--uninstall', '--pins', pinsFile()], noopIo(), uninstallToo.out, uninstallToo.err)).toBe(2);
    expect(uninstallToo.lines.join('\n')).toContain('cannot be combined');

    const purge = collect();
    expect(await run(['--plan', '--purge', '--pins', pinsFile()], noopIo(), purge.out, purge.err)).toBe(2);
    expect(purge.lines.join('\n')).toContain('--purge needs --uninstall');
  });

  // @level l3 @consumer a value flag with no value names the flag, so a missing argument is never read as a value.
  it('refuses a value flag whose value is missing or is the next flag', async () => {
    for (const [argv, flag] of [
      [['--plan', '--pins'], '--pins'],
      [['--plan', '--pins', '--root'], '--pins'],
      [['--plan', '--pins', pinsFile(), '--root'], '--root'],
      [['--plan', '--pins', pinsFile(), '--home'], '--home'],
    ] as const) {
      const sink = collect();
      expect(await run(argv, noopIo(), sink.out, sink.err)).toBe(2);
      expect(sink.lines.join('\n')).toContain(`${flag} needs a value`);
    }
  });

  // @level l3 @consumer a pins file whose pins are malformed names the file and the pin, not a TypeError later.
  it('refuses a malformed pin by file and pin name', async () => {
    const file = pinsFile({
      pins: {
        runtime: { version: '1.3.13', source: 'https://bun.invalid/1', checksum: 'sha256:' + 'a'.repeat(64) },
        ahpd: { version: '0.15.0-rc.4', source: 'https://reg.invalid/ahpd-0.15.0-rc.4-linux-x64.tar.gz', checksum: 'sha256:' + 'b'.repeat(64) },
        hostPlugin: { version: '0.1.0', source: 'https://reg.invalid/h.tgz', checksum: 'sha256:' + 'c'.repeat(64) },
      },
    });
    const sink = collect();
    expect(await run(['--plan', '--pins', file], noopIo(), sink.out, sink.err)).toBe(2);
    expect(sink.lines.join('\n')).toContain(`${file}: ${file} has no supervisor pin`);
  });

  // @level l3 @consumer a prune that fails after a good install is a warning, and the command still exits 0.
  it('prints a prune failure as a warning on a successful install', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ahpd-cli-home-'));
    const file = honestPinsFile();
    const pinned = JSON.parse(readFileSync(file, 'utf8')) as { pins: { ahpd: { source: string; checksum: string } } };
    const archive = daemonArchive(pinned.pins.ahpd.source);
    pinned.pins.ahpd.checksum = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
    writeFileSync(file, JSON.stringify(pinned));
    const io: InstallIo = {
      ...nodeInstallIo(),
      fetchTo: async (source, path) => {
        writeFileSync(path, source === pinned.pins.ahpd.source ? archive : bytesOf(source));
      },
      run: () => ({ code: 0, output: '' }),
      list: (path) => {
        throw new Error(`EACCES: ${path}`);
      },
    };
    const sink = collect();
    const code = await run(['--apply', '--pins', file, '--home', home], io, sink.out, sink.err);
    expect(code).toBe(0);
    const text = sink.lines.join('\n');
    expect(text).toContain('wrote ');
    expect(text).toMatch(/warning: could not prune releases at .*EACCES/);
  });
});
