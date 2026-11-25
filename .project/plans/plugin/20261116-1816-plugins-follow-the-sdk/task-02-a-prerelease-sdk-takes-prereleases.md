---
title: A prerelease sdk takes the prereleases its plugins admit
status: done
depends: [task-01-the-shipped-sdk-is-the-gate.md]
layer: server
refs:
  - "[code://packages/server/src/install.ts#L267-L282](../../../../packages/server/src/install.ts#L267-L282) - `fittingVersion`, the npm path"
  - "[code://packages/server/src/pluginlist.ts#L496-L503](../../../../packages/server/src/pluginlist.ts#L496-L503) - `fittingListed`, the list path"
  - "[code://packages/server/src/pluginlist.ts#L691-L695](../../../../packages/server/src/pluginlist.ts#L691-L695) - the version `details` answers"
  - "[code://packages/server/src/pluginlist.ts#L739](../../../../packages/server/src/pluginlist.ts#L739) - the versions `details` sends"
  - "[code://packages/server/src/compat.ts#L44-L78](../../../../packages/server/src/compat.ts#L44-L78) - `later`, which reads `X.Y.Z` only, and `newestFitting`"
---

## Objective

A daemon whose sdk is a prerelease takes a plugin's prerelease when the plugin's `@ahpd/sdk` range admits that sdk, from npm and from a list.
A daemon whose sdk is a release takes no prerelease, as today.
`available` and `details` send only the versions this daemon takes.

## Files

- `UPDATE: packages/server/src/compat.ts:44-78` - a shared `offered(version, sdk)` rule, and `later` reads a prerelease as `semver` does.
- `UPDATE: packages/server/src/install.ts:267-282` - `fittingVersion` takes a prerelease by `offered`, and the `latest` limit holds for releases only.
- `UPDATE: packages/server/src/pluginlist.ts:496-503` - `fittingListed` takes a prerelease by `offered`.
- `UPDATE: packages/server/src/pluginlist.ts:691-739` - `details` falls back by `offered`, and sends only the versions `offered` admits.
- `UPDATE: packages/server/src/commands/plugin.ts:669` - `availableAnswer` sends each entry's `versions` filtered by `offered`.
- `UPDATE: packages/server/test/plugin-compat.test.ts` - the cases of `offered` and of the new order.
- `UPDATE: packages/server/test/pluginlist.test.ts` - a listed prerelease, taken and skipped.
- `UPDATE: packages/server/test/plugin-install.test.ts` - an npm prerelease, taken and skipped.
- `UPDATE: packages/server/test/plugins-channel.test.ts` - `available` and `details` leave out what the daemon does not take.

## Steps

1. Add `offered(version, sdk)` to `compat.ts`, true for a release, and for a prerelease only when `sdk` is a prerelease.
2. Replace `later` with `semver.gt`, so `0.15.0` is later than `0.15.0-rc.4`, and `0.15.0-rc.4` later than `0.14.0`.
3. In `fittingVersion`, keep a version when `offered` admits it, and apply the `latest` limit to releases only.
4. In `fittingListed`, keep a version when `offered` admits it and the list does not mark it `deprecated`.
5. In `listedDetails` at `pluginlist.ts` line 694, replace the prerelease skip of the fallback with `offered`.
6. Filter the `versions` that `details` and `available` send by `offered` and by the range check of `newestFitting`.
7. Keep the range check in `newestFitting` as the one gate, which refuses an rc.4 plugin on an rc.3 sdk.
8. Update the doc comments of `fittingVersion`, `fittingListed` and `newestFitting` to state the rule.
9. Add the test cases that *Validation* names.

## Validation

- `plugin-compat.test.ts`: `offered` takes a release on any sdk, and a prerelease only on a prerelease sdk.
- `plugin-install.test.ts`: on sdk `0.15.0-rc.4`, a plugin at `0.14.0`, `0.15.0-rc.3` and `0.15.0-rc.4` installs `0.15.0-rc.4` when its range is `>=0.15.0-rc.4 <0.16.0-0`.
- The same case on sdk `0.15.0-rc.3` installs `0.15.0-rc.3`, and on sdk `0.14.0` installs `0.14.0`.
- `pluginlist.test.ts`: the same three cases for a listed plugin, and a case that skips a `deprecated` prerelease.
- `plugins-channel.test.ts`: on a release sdk, `available` and `details` send no prerelease.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server` passes.

## Resume

Built on 2026-11-16, awaiting review.

- The rule is `isOffered(version, sdk)`, since `offered` is already the name of the local lists it filters.
- `available` and `details` filter by `isOffered` alone, not by the range check. A picker still shows a release whose range refuses the sdk, as before; only the prereleases are new.
- `later` is `semver.gt`.

