---
title: The release run packs the part's packages once
status: done
depends:
  - task-02-a-release-writes-its-version-and-lock.md
layer: "release, docs"
refs:
  - "[code://.github/workflows/release.yml](../../../../.github/workflows/release.yml) - both jobs"
  - "[code://DEVELOPER.md#L141-L165](../../../../DEVELOPER.md#L141-L165) - what the release run does"
---

## Objective

The parts job packs the four packages, and the release job stages those tarballs and packs `@ahpd/computer` with the files that name them.

## Files

- `UPDATE: .github/workflows/release.yml` - the parts job builds, packs, writes and uploads; the release job downloads and checks.
- `UPDATE: DEVELOPER.md` - the release steps, and what to do before a new run of a staged tag.
- `UPDATE: docs/plugins/COMPUTERS.md` - which version a machine and a box run, for an installed host and for a checkout.
- `UPDATE: docs/updates/v0_16.md` - one line, or its text goes in this task's Resume if the page does not exist yet.

## Steps

1. Run `pnpm build` and pack the four packages in the parts job, then run `parts-bump.mjs --release`.
2. Give `parts-publish.mjs` the folder with `--packages`.
3. Upload the tarballs, `versions.json`, `parts/ahpd` and the digests, in a dry run too but without the digests.
4. Download them in the release job after the tests and the build, and before *Pack*.
5. Replace the four packed tarballs with the downloaded ones after *Pack*.
6. Fail when `@ahpd/computer` does not name the release's version, or a lock's integrity is not its tarball's.
7. Fail before *Stage the release* when npm serves one of the four at this version with another integrity.

## Validation

- Run `release.yml` as a dry run on the branch. All three jobs pass.
- The dry run's log shows the packed `@ahpd/computer` with the release's version and both locks.
- Write a file in `.project/pending/` for the rc check in the plan's *Final verification checklist*.

## Resume

Built on 2026-11-25. The pack and check steps ran on this host as a dry run would, and passed. Dry run 45533551795 passed all three jobs. The first one, 45531643591, failed on the sandbox runtime's tools, which the release job now installs. The notes for `v0_16.md`: an installed host runs its own version of ahpd in machines and on boxes.
