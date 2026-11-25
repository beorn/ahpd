---
title: The sdk the daemon ships is the gate
status: done
depends: []
layer: server
refs:
  - "[code://packages/sdk/src/version.ts#L21](../../../../packages/sdk/src/version.ts#L21) - `sdkVersion`, which every call in this task passes"
  - "[code://packages/server/src/install.ts#L568](../../../../packages/server/src/install.ts#L568) - `daemonsSdk`, the pin of the folder's sdk"
  - "[code://packages/server/src/pluginschannel.ts#L251](../../../../packages/server/src/pluginschannel.ts#L251) - `daemonVersion`, the plugin channel's version"
  - "[code://packages/server/src/selfupdate.ts#L183-L186](../../../../packages/server/src/selfupdate.ts#L183-L186) - `planUpdate`, where the target's sdk is read"
---

## Objective

Each version pick compares a plugin's range with the sdk the daemon ships, as the loader does.
The pick runs in the install, the update, the plugin channel and the check of `ahpd update`.
The folder's `@ahpd/sdk` is pinned to that sdk, and the server depends on the exact sdk of its release.

## Files

- `UPDATE: packages/server/src/install.ts:568-580` - `daemonsSdk` takes the sdk, and the `version` option of `InstallOptions` becomes `sdk`.
- `UPDATE: packages/server/src/install.ts:855` - the `version` option of `UpdateOptions` becomes `sdk`.
- `UPDATE: packages/server/src/install.ts:267` - `fittingVersion` names its argument `sdk`.
- `UPDATE: packages/server/src/pluginlist.ts:496-663` - `fittingListed` names its argument `sdk`, and `DetailsOptions.daemonVersion` becomes `sdk`.
- `UPDATE: packages/server/src/compat.ts:64` - `newestFitting` and `noFit` name their argument `sdk`.
- `UPDATE: packages/server/src/commands/plugin.ts:303` - `plugin install` and `plugin update` pass `sdkVersion()`.
- `UPDATE: packages/server/src/pluginschannel.ts:251` - the channel passes `sdkVersion()`.
- `UPDATE: packages/server/src/selfupdate.ts:183` - `planUpdate` also answers the target server's `@ahpd/sdk`; `checkPlugins` and `movePlugins` take it.
- `UPDATE: packages/server/src/commands/update.ts:150` - `ahpd update` passes the target's sdk to `checkPlugins` and to the move.
- `UPDATE: packages/server/package.json:48` - `@ahpd/sdk` becomes `workspace:*`.
- `UPDATE: pnpm-lock.yaml` - the server's sdk specifier.
- `UPDATE: packages/server/test/plugin-install.test.ts` - an install on a server whose version differs from its sdk's.
- `UPDATE: packages/server/test/update.test.ts` - `ahpd update` checks the plugins against the target's sdk.

## Steps

1. Run `rg -n "version\(\)" packages/server/src`, and list each call that reaches `fittingVersion`, `installPlugins`, `updatePlugins`, `checkPlugins` or `daemonsSdk`.
2. Rename the `version` option of `InstallOptions`, `UpdateOptions` and `PluginOptions` to `sdk`.
3. Document each `sdk` option as the sdk the daemon ships.
4. Rename the `daemonVersion` argument of `fittingVersion`, `fittingListed`, `newestFitting` and `noFit`, and `DetailsOptions.daemonVersion`, to `sdk`.
5. Pass `sdkVersion()` from `@ahpd/sdk` at each call of step 1.
6. Change `daemonsSdk` to pin the sdk that the caller passes.
7. In `planUpdate`, read the target `@ahpd/server` manifest from the registry and answer its `dependencies["@ahpd/sdk"]` as `sdk`.
8. When that dependency is a range, answer `minVersion` of it from `semver`, for a target released before this change.
9. Pass the target's `sdk` to `checkPlugins` and to the plugin move in `commands/update.ts`.
10. Set `@ahpd/sdk` to `workspace:*` in `packages/server/package.json`, and run `pnpm install` to update the lock.
11. Add a case to `plugin-install.test.ts`: a server at `0.16.0` with sdk `0.15.0` installs by the sdk.
12. Check in that case that the install pins sdk `0.15.0`.
13. Add a case to `update.test.ts`: a target whose sdk is `0.15.0` refuses a plugin whose range starts at `0.16.0-0`.

## Validation

- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server` passes.
- `rg -n "daemonVersion" packages/server/src` finds nothing.
- `pnpm -C packages/server pack --dry-run --json` shows `@ahpd/sdk` at the exact version of the sdk.

## Resume

Built on 2026-11-16, awaiting review.

- The `sdk` option replaces `version` in `InstallOptions`, `UpdateOptions`, `PluginOptions`, `ConfigureOptions` and `DetailsOptions`, and the channel's `sdk?()` replaces `version?()`. The type check found every caller, `commands/configure.ts` among them.
- `planUpdate` is unchanged. A new `targetSdk` in `selfupdate.ts` reads the target's sdk, and `ahpd update` calls it before the check. A registry with no answer gives the target's own version.
- The Windows helper runs the new binary's `plugin update all`, which reads `sdkVersion()`, so it needed no change.
- No case runs the CLI with a server version apart from its sdk's: the two are one file in this workspace. `server-update.test.ts` covers a target whose sdk differs from its version.
- `plugins-channel.test.ts` set `version` through a spread, which the type check did not see. It sets `sdk` now.
- Found, not changed: a plugin's `context.version` is the sdk's, and the computer plugin installs `@ahpd/server` at it in a machine.

