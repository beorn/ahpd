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
import { PACKED, lockDisagreements, packedManifest, packedVersion, siblingDisagreements, siblingWarnings, stampedVersion } from './pack-fork-release.mjs'

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

// The bug one layer in: `deploy` names `services` with `workspace:*`, so a pack that stamps one package at a time gives
// deploy's tarball the unstamped 0.16.0 while the services tarball says 0.16.0-<suffix> - uninstallable, and exactly
// what @cto's fd4b9906 refused. Both manifests are stamped before either is packed, and both are restored after.
test('a packed sibling dependency names the version this release packed, and the checkout is left as it was', async () => {
  const manifests = ['services', 'deploy'].map((name) => join(root, `packages/${name}/package.json`))
  const before = await Promise.all(manifests.map((path) => readFile(path, 'utf8')))
  const out = await mkdtemp(join(tmpdir(), 'ahpd-fork-release-test-'))
  execFileSync(
    process.execPath,
    ['scripts/pack-fork-release.mjs', '--only', 'services', '--only', 'deploy', '--suffix', 'beorn.0badf00d', '--out', out],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const deploy = packedManifest(join(out, 'ahpd-deploy-0.15.0-beorn.0badf00d.tgz'))
  expect(deploy.dependencies['@hallohuman/hightea-services']).toBe('0.16.0-beorn.0badf00d')
  expect(packedVersion(join(out, 'hallohuman-hightea-services-0.16.0-beorn.0badf00d.tgz'))).toBe('0.16.0-beorn.0badf00d')
  expect(await Promise.all(manifests.map((path) => readFile(path, 'utf8')))).toEqual(before)
}, 180_000)

test('a tarball whose sibling dependency disagrees with what was packed is refused', () => {
  const versions = new Map([['@hallohuman/hightea-services', '0.16.0-beorn.0badf00d']])
  expect(siblingDisagreements([{ packageName: 'deploy', manifest: { dependencies: { '@hallohuman/hightea-services': '0.16.0-beorn.0badf00d' } } }], versions)).toEqual([])
  expect(siblingDisagreements([{ packageName: 'deploy', manifest: { dependencies: { '@hallohuman/hightea-services': '0.16.0' } } }], versions)).toHaveLength(1)
  expect(siblingDisagreements([{ packageName: 'deploy', manifest: { dependencies: { '@hallohuman/hightea-services': 'workspace:*' } } }], versions)).toHaveLength(1)
})

// agent-acp and computer peer sdk at `>=0.15.0 <0.16.0-0`, which by semver excludes every prerelease - including this
// fork's own stamped 0.15.0-beorn.* that the fleet installs. Said out loud, not refused: a peer range describes the
// installer's tree, and refusing here would block every fork release on a manifest that has shipped this way for months.
test('a peer range naming another base version is reported, and one naming this base is not', () => {
  const versions = new Map([['@ahpd/sdk', '0.15.0-beorn.0badf00d']])
  const peer = (range) => [{ packageName: 'agent-acp', manifest: { peerDependencies: { '@ahpd/sdk': range } } }]
  expect(siblingWarnings(peer('>=0.15.0 <0.16.0-0'), versions)).toEqual([])
  expect(siblingDisagreements(peer('>=0.15.0 <0.16.0-0'), versions)).toEqual([])
  expect(siblingWarnings(peer('>=0.14.0 <0.15.0-0'), versions)).toHaveLength(1)
})

test('the lock resolves a packed sibling to its workspace copy, not to a registry version', async () => {
  const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')
  const siblings = new Map([['@hallohuman/hightea-services', 'services']])
  const entry = [{ packageName: 'deploy', dependencies: { '@hallohuman/hightea-services': 'workspace:*' } }]
  expect(lockDisagreements(lock, entry, siblings)).toEqual([])
  expect(lockDisagreements(lock, [{ packageName: 'deploy', dependencies: { '@hallohuman/hightea-services': '0.16.0' } }], siblings)).toHaveLength(1)
  const pinned = lock.replace(/(packages\/deploy:[\s\S]*?'@hallohuman\/hightea-services':\s*\n\s*specifier: workspace:\*\n\s*version: )link:\.\.\/services/u, '$10.16.0')
  expect(pinned).not.toBe(lock)
  expect(lockDisagreements(pinned, entry, siblings)).toHaveLength(1)
})
