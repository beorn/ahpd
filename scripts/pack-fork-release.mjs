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
 * Stamping is whole-workspace and happens before anything is packed (@cto fd4b9906): `deploy` depends on `services` with
 * `workspace:*`, which pnpm resolves from the sibling's manifest at pack time. Stamping one package at a time left
 * `deploy`'s tarball naming the unstamped `0.16.0` while the `services` tarball carried `0.16.0-<suffix>` — the same
 * uninstallable pair, one layer in. So: stamp every packed manifest, pack, restore every manifest in one `finally`, then
 * read each tarball's dependencies on the other packed packages and the lock, and refuse unless they agree.
 *
 *   node scripts/pack-fork-release.mjs --out <dir> [--suffix beorn.<sha8>] [--only services [--only deploy]]
 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** The manifest a packed tarball actually carries, read from the bytes rather than the name it was given. */
export const packedManifest = (tarball) =>
  JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }))

/** The version a packed tarball actually carries, read from the bytes rather than the name it was given. */
export const packedVersion = (tarball) => packedManifest(tarball).version

/**
 * What each packed tarball says about the other packed packages, refused unless it names the version this step stamped.
 * A `workspace:` range surviving into a tarball, or the sibling's unstamped version, means the pair cannot install
 * together — which is the whole of #38983.
 *
 * Only dependencies are refused. A peer range is a claim about the tree an installer builds, not bytes we ship: the
 * fork is a prerelease of the same base, and a range written for that base (`>=0.15.0 <0.16.0-0`) excludes every
 * prerelease by semver even while naming the release everybody installs. `siblingWarnings` says so out loud instead.
 */
export const siblingDisagreements = (packed, versions) => {
  const problems = []
  for (const { packageName, manifest } of packed) {
    const ranges = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) }
    for (const [dependency, range] of Object.entries(ranges)) {
      const stamped = versions.get(dependency)
      if (stamped === undefined) continue
      if (range !== stamped) {
        problems.push(`packages/${packageName} depends on ${dependency} at ${range}, and this release packed ${dependency}@${stamped}`)
      }
    }
  }
  return problems
}

/** A packed sibling's peer range that does not even name the base version this release stamped — a different line. */
export const siblingWarnings = (packed, versions) => {
  const warnings = []
  for (const { packageName, manifest } of packed) {
    for (const [dependency, range] of Object.entries(manifest.peerDependencies ?? {})) {
      const stamped = versions.get(dependency)
      if (stamped === undefined) continue
      const base = stamped.replace(/-.*$/u, '')
      const lower = /(\d+\.\d+\.\d+)/u.exec(range)?.[1]
      if (lower !== undefined && lower !== base) {
        warnings.push(`packages/${packageName} peers ${dependency} at ${range}, and this release packed ${base} (${stamped})`)
      }
    }
  }
  return warnings
}

/**
 * The lock the release workflow installs with `--frozen-lockfile`. Its importer entry must resolve each packed sibling
 * to the workspace copy (`link:../<dir>`), not to a registry version: a `link:` still holds after stamping, and a pinned
 * version there would install the wrong bytes even when both tarballs agree.
 */
export const lockDisagreements = (lock, entries, siblings) => {
  const problems = []
  const importers = new Map()
  let importer
  let section
  let dependency
  for (const line of lock.split('\n')) {
    const header = /^ {2}(\S.*):$/u.exec(line)
    if (header !== null) {
      importer = header[1].replace(/^'(.*)'$/u, '$1')
      section = undefined
      dependency = undefined
      importers.set(importer, new Map())
      continue
    }
    if (importer === undefined) continue
    if (/^ {4}\S/u.test(line)) {
      section = /^ {4}(\w+):$/u.exec(line)?.[1]
      dependency = undefined
      continue
    }
    if (section === undefined || !/(?:^|[Dd])ependencies$/u.test(section)) continue
    const name = /^ {6}(\S.*):$/u.exec(line)
    if (name !== null) {
      dependency = name[1].replace(/^'(.*)'$/u, '$1')
      importers.get(importer).set(dependency, {})
      continue
    }
    const field = /^ {8}(specifier|version): (.*)$/u.exec(line)
    if (field !== null && dependency !== undefined) importers.get(importer).get(dependency)[field[1]] = field[2]
  }
  for (const { packageName, dependencies } of entries) {
    const held = importers.get(`packages/${packageName}`)
    if (held === undefined) {
      problems.push(`pnpm-lock.yaml has no importer for packages/${packageName}`)
      continue
    }
    for (const [dependency, range] of Object.entries(dependencies)) {
      if (!siblings.has(dependency)) continue
      const entry = held.get(dependency)
      if (entry === undefined) {
        problems.push(`pnpm-lock.yaml has no ${dependency} entry for packages/${packageName}, which depends on it`)
        continue
      }
      if (entry.specifier !== range) {
        problems.push(`pnpm-lock.yaml records packages/${packageName}'s ${dependency} as ${entry.specifier}, not the ${range} its manifest asks for; run pnpm install`)
        continue
      }
      const version = entry.version ?? ''
      const target = normalize(join('packages', packageName, version.slice('link:'.length)))
      if (!version.startsWith('link:') || target !== normalize(join('packages', siblings.get(dependency)))) {
        problems.push(`pnpm-lock.yaml resolves packages/${packageName}'s ${dependency} to ${version}, not its workspace copy under packages/`)
      }
    }
  }
  return problems
}

/**
 * Thrown, never `process.exit`: a refusal raised between stamping and restoring must unwind through the `finally` that
 * puts every manifest back, and an exit ends the process without running it — leaving all six manifests stamped in the
 * checkout (@dev/6's review of 8fffcd29). Only the entry point turns this into an exit code, after the unwinding.
 */
export class Refusal extends Error {}

const refuse = (why) => {
  throw new Refusal(why)
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

const argsOf = (name) => process.argv.flatMap((argument, at) => (argument === `--${name}` ? [process.argv[at + 1]] : []))

const readManifest = async (root, packageName) => {
  const path = join(root, 'packages', packageName, 'package.json')
  const original = await readFile(path, 'utf8')
  return { packageName, path, original, manifest: JSON.parse(original) }
}

const main = async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const suffix = argsOf('suffix')[0] ?? `beorn.${execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()}`
  const only = argsOf('only')
  const out = argsOf('out')[0] ?? (await mkdtemp(join(tmpdir(), 'ahpd-fork-release-')))
  const packing = only.length === 0 ? PACKED : PACKED.filter((one) => only.includes(one))
  if (packing.length === 0) refuse(`--only ${only.join(', ')} names no packed package (${PACKED.join(', ')})`)
  // Every packed manifest is stamped, not just the ones being packed: a sibling's `workspace:*` resolves from its
  // manifest, so leaving one unstamped is how the tarballs disagree even when each was stamped when its turn came.
  const stamped = []
  for (const packageName of PACKED) {
    const held = await readManifest(root, packageName)
    let expected
    try {
      expected = stampedVersion(held.manifest.version, suffix)
    } catch (error) {
      refuse(`packages/${packageName}: ${error.message}`)
    }
    held.expected = expected
    stamped.push(held)
  }
  const versions = new Map(stamped.map((held) => [held.manifest.name, held.expected]))
  const siblings = new Map(stamped.map((held) => [held.manifest.name, held.packageName]))
  const written = []
  let packed = []
  try {
    for (const held of stamped) {
      // The first `"version":` in each of these six manifests is the top-level one; a nested one would need a parse and
      // a re-serialise, which reorders the file and makes the restore in the `finally` harder to trust.
      await writeFile(held.path, held.original.replace(/("version":\s*")[^"]+(")/u, `$1${held.expected}$2`))
      written.push(held)
    }
    for (const held of stamped.filter((one) => packing.includes(one.packageName))) {
      execFileSync(pnpm[0], [...pnpm.slice(1), 'pack', '--pack-destination', out], {
        cwd: join(root, 'packages', held.packageName),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      // pnpm names a scoped package's tarball `scope-name-version.tgz`, the same shape npm and the pinned URLs use.
      const tarball = join(out, `${held.manifest.name.replace(/^@/u, '').replace(/\//gu, '-')}-${held.expected}.tgz`)
      let manifest
      try {
        manifest = packedManifest(tarball)
      } catch {
        refuse(`packages/${held.packageName} packed no readable tarball at ${tarball}`)
      }
      if (manifest.version !== held.expected) {
        refuse(`${tarball} carries version ${manifest.version}, not the ${held.expected} its name and every pinned URL state`)
      }
      packed.push({ packageName: held.packageName, manifest })
    }
  } finally {
    for (const held of written.reverse()) await writeFile(held.path, held.original)
  }
  const disagreements = [
    ...siblingDisagreements(packed, versions),
    ...lockDisagreements(
      await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'),
      // The manifests as committed, not as packed: the lock holds the ranges an author wrote (`workspace:*`), while
      // the tarball holds what pnpm resolved them to, and only the former can disagree with the lock.
      packed.map(({ packageName }) => ({
        packageName,
        dependencies: JSON.parse(stamped.find((held) => held.packageName === packageName).original).dependencies ?? {},
      })),
      siblings,
    ),
  ]
  if (disagreements.length > 0) refuse(disagreements.join('\n  '))
  for (const warning of siblingWarnings(packed, versions)) console.error(`pack warning: ${warning}`)
  for (const { manifest } of packed) console.log(`${manifest.name}@${manifest.version}`)
  console.log(`packed ${packed.length} package(s) into ${out} with suffix ${suffix}`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.error(`pack refused: ${error.message}`)
    process.exitCode = 1
  }
}
