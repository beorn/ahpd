#!/usr/bin/env node
/**
 * Pack the fork release's npm packages so each artifact's internal version cannot disagree with the version its
 * filename — and the pinned URL in hightea that copies that filename — names (#38983, @cto a76b1ed6 change 1).
 *
 * Why: the hh-38499-dc5a62e1 release shipped `hallohuman-hightea-services-0.16.0-beorn.dc5a62e1.tgz` whose package.json
 * said plain `0.16.0`. `@ahpd/deploy` in the same release required exactly `0.16.0-beorn.dc5a62e1`, so npm fell back
 * to the registry and 404'd: the hightea CLI that pinned it (0.1.34) could not install. Nothing in either repo compared
 * the filename to the manifest; the versions were written by hand, per package.
 *
 * So the pack step owns the suffix, not the author: every packed package's version is `<its x.y.z base>-<suffix>`, and
 * the tarball is read back and refused if it disagrees.
 *
 *   node scripts/pack-fork-release.mjs --out <dir> [--suffix beorn.<sha8>] [--only services]
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The packages hightea's dependency URLs pin today; `services` is here because hh-38499 left it out of every check. */
export const PACKED = ['sdk', 'server', 'deploy', 'agent-acp', 'computer', 'services']

/**
 * The version a package must carry: its own x.y.z base and the release suffix. An already-suffixed base is replaced,
 * never doubled, so re-running the step cannot produce `0.16.0-beorn.a-beorn.b`.
 */
export const stampedVersion = (base, suffix) => {
  const plain = String(base).replace(/-.*$/u, '')
  if (!/^\d+\.\d+\.\d+$/u.test(plain)) throw new Error(`\`${base}\` has no x.y.z base version to stamp`)
  if (!/^[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*$/u.test(String(suffix))) throw new Error(`\`${suffix}\` is not a usable version suffix`)
  return `${plain}-${suffix}`
}

/** The version a packed tarball actually carries, read from the bytes rather than the name it was given. */
export const packedVersion = (tarball) =>
  JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' })).version

const refuse = (why) => {
  console.error(`pack refused: ${why}`)
  process.exit(1)
}

/** pnpm is what the release workflow packs with; a checkout without it gets the same version through corepack. */
const pnpm = (() => {
  try {
    execFileSync('pnpm', ['--version'], { stdio: 'ignore' })
    return ['pnpm']
  } catch {
    return ['corepack', 'pnpm']
  }
})()

const argOf = (name) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const main = async () => {
  const root = new URL('..', import.meta.url).pathname
  const suffix = argOf('suffix') ?? `beorn.${execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`
  const only = argOf('only')
  const out = argOf('out') ?? (await mkdtemp(join(tmpdir(), 'ahpd-fork-release-')))
  const packages = only === undefined ? PACKED : PACKED.filter((one) => one === only)
  if (packages.length === 0) refuse(`--only ${only} names no packed package (${PACKED.join(', ')})`)
  const packed = []
  for (const packageName of packages) {
    const manifest = join(root, 'packages', packageName, 'package.json')
    const original = await readFile(manifest, 'utf8')
    const { name, version } = JSON.parse(original)
    let expected
    try {
      expected = stampedVersion(version, suffix)
    } catch (error) {
      refuse(`packages/${packageName}: ${error.message}`)
    }
    try {
      await writeFile(manifest, original.replace(/("version":\s*")[^"]+(")/u, `$1${expected}$2`))
      execFileSync(pnpm[0], [...pnpm.slice(1), 'pack', '--pack-destination', out], { cwd: join(root, 'packages', packageName), stdio: ['ignore', 'pipe', 'pipe'] })
    } finally {
      await writeFile(manifest, original)
    }
    // pnpm names a scoped package's tarball `scope-name-version.tgz`, the same shape npm and the pinned URLs use.
    const tarball = join(out, `${name.replace(/^@/u, '').replace(/\//gu, '-')}-${expected}.tgz`)
    let inside
    try {
      inside = packedVersion(tarball)
    } catch {
      refuse(`packages/${packageName} packed no readable tarball at ${tarball}`)
    }
    if (inside !== expected) {
      refuse(`${tarball} carries version ${inside}, not the ${expected} its name and every pinned URL state`)
    }
    packed.push(`${name}@${inside}`)
  }
  for (const line of packed) console.log(line)
  console.log(`packed ${packed.length} package(s) into ${out} with suffix ${suffix}`)
}

if (process.argv[1] !== undefined && new URL(import.meta.url).pathname === process.argv[1]) await main()
