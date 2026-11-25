---
title: The fork has the gate and the zod range
status: done
depends: []
layer: "ahpio/sandbox-runtime"
refs:
  - https://github.com/anthropics/sandbox-runtime/pull/246 - the gate's behaviour
  - https://github.com/anthropics/sandbox-runtime/blob/v0.0.83/.github/workflows/release.yml - the release
---

## Objective

`ahpio/sandbox-runtime` is a fork cut at `v0.0.83`, with `network.enabled`, zod `^3.25.0 || ^4.6.6`, and the package named `@ahpio/sandbox-runtime`. This task's paths are in the fork's repository.

## Files

- `UPDATE: src/sandbox/sandbox-config.ts` - `enabled` in `NetworkConfigSchema`, default true.
- `UPDATE: src/sandbox/sandbox-manager.ts` - no proxy, no filter and no network restriction when `enabled` is false.
- `UPDATE: package.json` - the name, the version `0.0.83-rc.0`, the repository, and the zod range.
- `UPDATE: .github/workflows/release.yml` - publish `@ahpio/sandbox-runtime` with `--tag next` for a prerelease.
- `CREATE: NOTICE` - the two changes, under Apache-2.0.
- `CREATE: test/sandbox/network-gate.test.ts` - the gate on and off, and the filesystem rules kept, under `bun test`.

## Steps

1. Work on a branch of `ahpio` in `/github/sandbox-runtime`, the fork's clone, whose default branch `ahpio` is `v0.0.83`.
2. Add `enabled` to the network schema, and keep a value of `true` unchanged.
3. Skip the proxies in `initialize` when `enabled` is false.
4. Allow every request in `filterNetworkRequest` when `enabled` is false.
5. Apply no network restriction in `wrapWithSandbox` when `enabled` is false.
6. Keep every filesystem rule in both cases.
7. Widen the zod range, and run the suite under zod 3.25 and under zod 4.6.6.
8. Rename the package, set the version, and write `NOTICE`.
9. Leave the push and the pull request, which runs `release.yml` without the publish, to the owner of the build.

## Validation

- `test/sandbox/network-gate.test.ts` - a request to an unlisted host goes through only with `enabled: false`, on Linux, macOS and Windows.
- The fork's own suite passes under both zod versions.
- `release.yml` passes on the pull request.

## Resume
