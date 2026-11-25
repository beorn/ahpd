---
title: The ahpd part is the release's own build
domain: container
status: active
priority: high
created: 2026-11-25
revalidated: 2026-11-25
requires:
  - plans/container/20261113-0507-the-ahpd-part-follows-the-release/plan.md
changes:
  - specs/nested-hosts.md
refs:
  - git://6c1da5da2 - the last commit that holds `briefs/the-ahpd-part-is-the-releases-own-build.md`, which this plan and container/20261125-0131 replace
  - git://74ae538c8 - the commit the facts were checked at
  - "[code://packages/computer/src/parts.ts#L731-L772](../../../../packages/computer/src/parts.ts#L731-L772) - `lockOf` and `fromLock`: a part's two files, and the `npm ci` that installs from them"
  - "[code://packages/computer/src/parts.ts#L830-L875](../../../../packages/computer/src/parts.ts#L830-L875) - `dockerfileOf`: the published ahpd is installed from its lock, and its plugins with no lock"
  - "[code://packages/computer/src/hostinstall.ts#L161-L185](../../../../packages/computer/src/hostinstall.ts#L161-L185) - the install on a box reads the same version and lock"
  - "[code://scripts/parts-bump.mjs#L75-L84](../../../../scripts/parts-bump.mjs#L75-L84) - `lock`: writes a part's two files"
  - "[code://scripts/parts-publish.mjs](../../../../scripts/parts-publish.mjs) - builds and pushes each part at the tag a host asks for"
  - "[code://.github/workflows/release.yml](../../../../.github/workflows/release.yml) - the `release` job packs after the `parts` job"
  - https://docs.npmjs.com/cli/v11/commands/npm-cache - `npm cache add` puts a tarball in the cache, where `npm ci` finds it by its integrity
---

## Goal

A host installed from a release runs its own version of ahpd in its machines and on its ssh boxes.
Today both run the version committed in the repository, which is at least one release older.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "lockOf\(|ahpdSourceOf|hostInstallOf"` - the host reads the version and the lock from the files `@ahpd/computer` ships, in machines and on boxes alike.
- Read `Dockerfile` and `edge.yml` - the daemon's image holds no `@ahpd/computer`. A person installs the plugin from npm.

### What was tried on 2026-11-25

- npm 12.0.2 made a lock from `file:` tarballs of a version that npm does not serve. Its `resolved` values were then set to registry URLs.
- `npm ci` from that lock failed with an empty cache, and passed after `npm cache add` of the tarballs.
- The same steps on the four real 0.15.0 tarballs gave `@ahpd/server` the integrity npm serves. The other three were not compared.
- The plugins locked the same way, with `--legacy-peer-deps`: 134 packages. An offline `npm ci` from a filled cache installed both folders, and `ahpd --version` answered.

### Runtime path

```
tag -> parts job packs, writes the version and the lock, builds the image -> release job stages the same tarballs, with the files in @ahpd/computer -> host reads them -> machine or box
```

### Gaps

- The plugins of the ahpd part have no lock, so what they resolve to differs by day.
- The part's image is built by `npm ci`, which cannot read a version npm does not serve.
- The packages are packed after the parts job, so the job has nothing to lock.
- Not shown: a tag run where npm serves the bytes that the run staged. The rc in *Final verification checklist* shows it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A box installs from npm, from a lock that the release run writes for its own version and ships in `@ahpd/computer` | Softov, 2026-11-24: "both" | 02 |
| A host run from a checkout uses the version committed in `versions.json`, and `AHPD_PART_AHPD_ROOT` still gives machines the checkout's code | Softov, 2026-11-25: "Committed version, as today" | 02 |
| The release run replaces that version in its own tree, and commits nothing | (defaulted: `digests.json` is made the same way) | 02, 03 |
| The plugins of the part are installed from a second lock | (defaulted: a version not on npm can be installed in no other way, and the copy of container/20261125-0131 needs each file named) | 01 |
| The four packages of the part are packed once, and the release stages those tarballs | (defaulted: the lock holds the hash of their bytes) | 03 |
| The weekly bump still moves the committed version | Softov, 2026-11-25: "Committed version, as today" | - |

## Proposed architecture

- **Data flow** - the parts job packs `sdk`, `server`, `agent-cofold` and `agent-pi`. It writes the host's version in `versions.json` and both locks in `parts/ahpd`, and builds the image with those tarballs in npm's cache. The release job packs `@ahpd/computer` with these files.
- **State flow** - the image's tag already hashes the lock, so a host asks for the release's own image with no new field.
- **Layer responsibilities** - `scripts/parts-bump.mjs`: the release's version and locks · `packages/computer`: the second lock and the cache step · `release.yml`: one pack, two jobs.
- **Source-of-truth files** - [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The plugins install from a lock](task-01-the-plugins-install-from-a-lock.md) | done | - |
| [02 - A release writes its version and lock](task-02-a-release-writes-its-version-and-lock.md) | done | 01 |
| [03 - The release run packs once](task-03-the-release-run-packs-once.md) | done | 02 |

## Risks and tradeoffs

- Softov approves the packages one by one. A box install fails until the last one is served, as it does today, and runs an older install if it has one. A machine's image does not wait, because the registry serves it at once.
- A rerun of the failed jobs keeps the tarballs. A new run of a tag whose packages are staged may pack other bytes, and npm then serves what the lock does not name. Task 03 refuses a run whose bytes differ from what npm serves. Staged packages are not readable, so the docs say to reject them first.
- No machine runs the part of an unapproved tag, unless its host was packed from that run.
- The tag of the ahpd image changes once, because its Dockerfile changes.

## Resume state

- **Done so far:** every task, on 2026-11-25, as [implemented.md](implemented.md) says.
- **Next action:** the rc check in [pending/the-ahpd-part-of-a-release.md](../../../pending/the-ahpd-part-of-a-release.md), then Softov's review.
- **Open questions:** none.
- **Watch out for:** the Dockerfile's text is the tag, and an installed host only hashes it. The text must be the same with and without the tarballs. `npm cache add` takes one `./` path per run; without `./` npm 12 reads the path as a git address.

## Final verification checklist

- [ ] `pnpm typecheck` and the computer suite pass.
- [ ] A dry run of `release.yml` passes, and its packed `@ahpd/computer` names the host's own version and both locks.
- [ ] After the next rc is approved, npm's `dist.integrity` of the four packages equals the lock's, and a box and a machine run that rc.
