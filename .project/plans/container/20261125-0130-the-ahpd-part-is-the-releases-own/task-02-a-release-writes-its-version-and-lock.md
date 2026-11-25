---
title: A release writes its own version and lock
status: done
depends:
  - task-01-the-plugins-install-from-a-lock.md
layer: "computer, scripts"
refs:
  - "[code://scripts/parts-bump.mjs#L60-L84](../../../../scripts/parts-bump.mjs#L60-L84) - `dependenciesOf` and `lock`"
  - "[code://scripts/parts-publish.mjs#L133-L150](../../../../scripts/parts-publish.mjs#L133-L150) - the build context of each part"
---

## Objective

One command writes the version and both locks of the ahpd part from packed tarballs.
The part's image builds from the tarballs before npm serves them.

## Files

- `UPDATE: scripts/parts-bump.mjs` - `--release <folder>` writes the version and the locks from the tarballs in the folder.
- `UPDATE: packages/computer/src/parts.ts` - the published part's Dockerfile copies `*.tgz` if there are any, and adds each to npm's cache before `npm ci`.
- `UPDATE: scripts/parts-publish.mjs` - `--packages <folder>` puts the tarballs in the ahpd part's context.
- `UPDATE: packages/computer/test/parts-bump.test.ts` - the `--release` cases.
- `UPDATE: packages/computer/test/parts-publish.test.ts` - the `--packages` case.
- `UPDATE: packages/computer/test/computer-parts.test.ts` - the Dockerfile's cache step.

## Steps

1. Read the version from the tarballs, and refuse a folder where the four packages are missing or differ in version.
2. Lock the `file:` tarballs, then set each `file:` `resolved` to its registry URL and each dependency to its version.
3. Refuse a lock that still holds `file:`, or one whose integrity is not the sha512 of its tarball.
4. Write the version in `versions.json`, and leave every other part as it is.
5. Copy the tarballs with a wildcard that matches none in a context without them.
6. Add each tarball with its own `npm cache add ./<file>`, then run `npm ci`.
7. Put the tarballs in the context from `--packages`.

## Validation

- `--release` on four stand-in tarballs writes the version, the manifests and the locks. The locks hold registry URLs and each tarball's sha512.
- A folder with a missing package, or with two versions, is refused, and no file changes.
- The Dockerfile text and the tag are equal with and without `--packages`.
- Pack the four packages at a version npm does not serve. Build the image from them with `--local --packages`. `ahpd --version` in it answers that version.

## Resume

Done on 2026-11-25. Four packages at 0.99.0, which npm does not serve, built the image, and `ahpd --version` in it answers 0.99.0.
