---
title: The fork's first release is on npm
status: done
depends: [task-01-the-fork-has-the-gate-and-zod.md]
layer: "ahpio/sandbox-runtime, npm"
refs:
  - https://docs.npmjs.com/trusted-publishers - trusted publishing, set on a package that exists
---

## Objective

`@ahpio/sandbox-runtime@0.0.83-rc.0` is on npm, and later releases publish from `release.yml` with trusted publishing.

## Files

- `CREATE: .project/pending/sandbox-runtime-first-release.md` - Softov's steps for the first publish and the trusted publisher, in ahpd.

## Steps

1. Write the pending check file with Softov's steps after task 01 merges in the fork.
2. Wait for Softov to publish the first version with his npm login.
3. Wait for Softov to add `ahpio/sandbox-runtime`'s `release.yml` and the `npm` environment as the trusted publisher.
4. Check `npm view @ahpio/sandbox-runtime@0.0.83-rc.0`.
5. Delete the pending check file once Softov reports it done.

## Validation

- `npm view @ahpio/sandbox-runtime@0.0.83-rc.0 version` prints the version.
- The package page names the trusted publisher.

## Resume

Done 2026-11-22. Softov published a `0.0.0` placeholder by hand and set the trusted publisher. The GitHub prerelease `v0.0.83-rc.0` on `2a71a1f` ran `release.yml` run 45039413969, which published `0.0.83-rc.0` under `next` with provenance. The pending check file is deleted.
