/**
 * The fork release cannot ship a package whose manifest version disagrees with the version its filename and the pinned
 * URLs that copy it name (#38983: hh-38499's services tarball said 0.16.0 inside a name that said
 * 0.16.0-beorn.dc5a62e1, so hightea 0.1.34 could not install).
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { PACKED, packedVersion, stampedVersion } from './pack-fork-release.mjs'

const root = new URL('..', import.meta.url).pathname

test('a package carries its own base version and the release suffix, never two suffixes', () => {
  expect(stampedVersion('0.16.0', 'beorn.dc5a62e1')).toBe('0.16.0-beorn.dc5a62e1')
  expect(stampedVersion('0.15.0-beorn.old12345', 'beorn.dc5a62e1')).toBe('0.15.0-beorn.dc5a62e1')
  expect(() => stampedVersion('latest', 'beorn.dc5a62e1')).toThrow(/no x\.y\.z base/)
  expect(() => stampedVersion('0.16.0', '')).toThrow(/not a usable version suffix/)
  expect(() => stampedVersion('0.16.0', 'beorn..x')).toThrow(/not a usable version suffix/)
})

test('hightea pins services, so the pack step must list it', () => {
  expect(PACKED).toContain('services')
})

test('the packed tarball carries the stamped version, and the checkout is left as it was', async () => {
  const manifest = join(root, 'packages/services/package.json')
  const before = await readFile(manifest, 'utf8')
  const out = await mkdtemp(join(tmpdir(), 'ahpd-fork-release-test-'))
  execFileSync(process.execPath, ['scripts/pack-fork-release.mjs', '--only', 'services', '--suffix', 'beorn.0badf00d', '--out', out], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const tarball = join(out, 'hallohuman-hightea-services-0.16.0-beorn.0badf00d.tgz')
  expect(packedVersion(tarball)).toBe('0.16.0-beorn.0badf00d')
  expect(await readFile(manifest, 'utf8')).toBe(before)
}, 120_000)
