---
title: A plugin follows the sdk the daemon ships
domain: plugin
status: built
priority: high
created: 2026-11-16
revalidated: 2026-11-16
requires:
  - file:///github/ahpio-site/.project/plans/plugins/20261116-1816-the-list-serves-prereleases/plan.md
refs:
  - git://b884d5a19 - the last commit that holds the brief `briefs/plugins-follow-the-release-line.md`, which this plan covers
  - "[code://packages/sdk/src/version.ts#L21](../../../../packages/sdk/src/version.ts#L21) - `sdkVersion`, the version of the sdk the daemon ships"
  - "[code://packages/server/src/plugins.ts#L1114](../../../../packages/server/src/plugins.ts#L1114) - the loader checks a plugin's range against `sdkVersion()`, the gate this plan copies"
  - "[code://packages/server/src/install.ts#L267-L282](../../../../packages/server/src/install.ts#L267-L282) - `fittingVersion`, which skips every prerelease and every version newer than `latest`"
  - "[code://packages/server/src/install.ts#L568](../../../../packages/server/src/install.ts#L568) - `daemonsSdk`, which pins the folder's sdk to the daemon's own version"
  - "[code://packages/server/src/pluginlist.ts#L496-L503](../../../../packages/server/src/pluginlist.ts#L496-L503) - `fittingListed`, which skips every listed prerelease"
  - "[code://packages/server/src/pluginlist.ts#L691-L695](../../../../packages/server/src/pluginlist.ts#L691-L695) - the version `details` answers, with its own prerelease skip"
  - "[code://packages/server/src/compat.ts#L44-L78](../../../../packages/server/src/compat.ts#L44-L78) - `later` and `newestFitting`; `later` compares `X.Y.Z` only"
  - "[code://packages/server/src/pluginschannel.ts#L251](../../../../packages/server/src/pluginschannel.ts#L251) - the plugin channel passes the daemon's own version"
  - "[code://packages/server/src/commands/plugin.ts#L303](../../../../packages/server/src/commands/plugin.ts#L303) - `plugin install` and `plugin update` pass the daemon's own version"
  - "[code://packages/server/src/selfupdate.ts#L183-L186](../../../../packages/server/src/selfupdate.ts#L183-L186) - `planUpdate`, which answers the target server's version"
  - "[code://packages/server/src/commands/update.ts#L150](../../../../packages/server/src/commands/update.ts#L150) - `ahpd update` checks the plugins against the target server's version"
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - a first-party plugin's `@ahpd/sdk` peer range, `>=0.14 <1` on main"
  - "[code://.github/workflows/release.yml#L132-L153](../../../../.github/workflows/release.yml#L132-L153) - the pack and the check of each tarball's ranges"
  - "[code://.github/workflows/ci.yml#L47](../../../../.github/workflows/ci.yml#L47) - `pnpm boundary`, the check the range check sits beside"
  - "[code://docs/updates/v0_15.md#L20](../../../../docs/updates/v0_15.md#L20) - the 0.15.0 *Upgrading* section"
  - "[code://docs/plugins/PLUGINS.md#L1561](../../../../docs/plugins/PLUGINS.md#L1561) - the `@ahpd/sdk` range: the oldest sdk a plugin needs"
  - "[code://docs/plugins/PLUGINS.md#L2176](../../../../docs/plugins/PLUGINS.md#L2176) - how an install picks a listed version, prereleases left out"
  - npm://semver@7.8.6 - *Prerelease Tags*: a prerelease satisfies a range only through a comparator of its own `[major, minor, patch]`
  - npm://@babel/plugin-transform-runtime@7 - peers on `@babel/core ^7.0.0-0`, where `-0` admits the prereleases
---

## Goal

An upgrade keeps every agent working, also an upgrade to a release candidate.
A plugin is checked against the sdk the daemon ships, when it loads and when its version is picked.
A daemon whose sdk is a prerelease takes a plugin's prerelease when the plugin's range admits that sdk.
Each release sets the first-party plugins' range from the sdk it ships to the next minor, and CI and the release refuse any other range.
The 0.15 release notes tell a tester what to run after an upgrade.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The facts of the upgrade check are in the brief at `git://b884d5a19`.

### Searches performed

- `rg "sdkVersion\(" packages/server/src` - the loader passes the sdk's version at `plugins.ts` lines 146, 1191, 1393, 1952 and 2483.
- `rg "version\(\)" packages/server/src` - `plugin install`, `plugin update` and the plugin channel pass the daemon's own version.
- `rg "fittingVersion\(" packages/server/src` - the install, the update and `checkPlugins` call it.
- `rg '"@ahpd/sdk"' packages/*/package.json` - 11 plugins declare `>=0.14 <1`, and the server depends on `workspace:^`.
- `curl https://plugins.ahpio.com/v1/plugins.json` on 2026-11-16 - 12 plugins, each at 0.14.0 only.
- `installedListing` matches every `@ahpd/*` plugin to the list by its name, also one installed from npm.

### Runtime path

```
plugin install | plugin update | x-ahpd/plugins/* -> sdkVersion() -> fittingVersion | fittingListed -> releases, and prereleases when the sdk is one -> newestFitting -> npm install, the sdk pinned to sdkVersion()
ahpd update -> planUpdate -> the target server's @ahpd/sdk -> checkPlugins -> updatePlugins
daemon start -> loader -> satisfies(sdkVersion(), range) -> load or refuse
release bump -> node scripts/sdk-range.mjs --write -> CI and release.yml run node scripts/sdk-range.mjs
```

### Gaps

- The install and the update compare a range with the daemon's version, not the sdk's.
- Every prerelease is skipped, from npm and from a list.
- `later` in `compat.ts` compares `X.Y.Z` only.
- Nothing sets or checks the plugins' range at a release.
- The list serves no prerelease. The ahpio-site plan in `requires` adds them.
- A published 0.14.0 backend declares `>=0.10 <1`, and npm keeps it as it is. Only the notes help an upgrade from 0.14.0.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin's range is checked against the sdk the daemon ships, not the daemon's version | Softov, 2026-11-16: "The sdk the daemon ships" | 01 |
| A daemon whose sdk is a prerelease takes a plugin's prerelease when the plugin's range admits that sdk; a stable sdk takes no prerelease | Softov, 2026-11-16: "The range decides" | 02 |
| The rule holds for every package, `@ahpd/*` or not | Softov, 2026-11-16: "Every package, same rule" | 02 |
| The plugin list serves prereleases, and the daemon reads them by the same rule | Softov, 2026-11-16: "The list serves prereleases" | 02 |
| Each release sets a first-party plugin's range to `>=<the sdk it ships> <<next minor>.0-0>`, such as `>=0.15.0-rc.4 <0.16.0-0` | Softov, 2026-11-16: "The range decides" | 03 |
| The release refuses a plugin whose range differs | Softov, 2026-11-16, in the brief | 03 |
| The server depends on the exact sdk of its release, `workspace:*`, so `ahpd update` knows the target's sdk before it installs | (defaulted: a range lets npm pick an sdk the server was not tested with, and the update check cannot know it) | 01 |
| `available` and `details` send only the versions this daemon takes | (defaulted: a picker that offers a version the daemon refuses leads to a failed install) | 02 |
| One script sets the ranges at a bump, and CI and the release run it as a check | (defaulted: the range moves at every release now, so 11 edits by hand would drift) | 03 |
| The 0.15 notes tell a tester to run `ahpd plugin update all` after an `ahpd update` to a release candidate, and say both changes under *Upgrading* | Softov, 2026-11-16, in the brief | 04 |

## Proposed architecture

- **Data flow** - each version pick reads `sdkVersion()`. `ahpd update` reads the target's sdk from the target server's registry manifest.
- **State flow** - the folder's `@ahpd/sdk` is pinned to the sdk the daemon ships. No new state.
- **Layer responsibilities** - server: the version pick, the pin, the update check · scripts: `sdk-range.mjs` · workflows: the range check.
- **Source-of-truth files** - [`code://packages/sdk/package.json`](../../../../packages/sdk/package.json) holds the version every range starts from.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the-shipped-sdk-is-the-gate](task-01-the-shipped-sdk-is-the-gate.md) | done | - |
| [02 - a-prerelease-sdk-takes-prereleases](task-02-a-prerelease-sdk-takes-prereleases.md) | done | 01 |
| [03 - a-release-sets-the-sdk-range](task-03-a-release-sets-the-sdk-range.md) | done | - |
| [04 - the-notes-say-how-to-upgrade](task-04-the-notes-say-how-to-upgrade.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- An upgrade from 0.14.0 still loads no backend until `ahpd plugin update all` runs - the notes say so, since npm keeps the 0.14.0 packages as they are.
- `ahpd update` from rc.3 to rc.4 runs the code of rc.3 - the notes say to run `ahpd plugin update all` after it.
- A listed plugin finds no prerelease until the ahpio-site plan is deployed - this plan requires it.
- The range starts at the release's own sdk, so an rc.3 daemon refuses an rc.4 plugin - the update picks the rc.3 plugin, which npm keeps.
- A third-party prerelease is taken when its range admits a prerelease sdk - Softov chose one rule for every package.

## Resume state

- **Done so far:** tasks 01 to 04 built on 2026-11-16 on branch `plugin/20261116-1816-plugins-follow-the-sdk`, awaiting review. The server, sdk and computer suites pass.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** the sdk and the server have one version today, so a test passes with either. Give a test server a version apart from its sdk's.

## Final verification checklist

- [ ] A test daemon on the rc.4 candidate, upgraded from 0.14.0, loads every backend after `ahpd plugin update all`.
- [ ] `node scripts/sdk-range.mjs` passes on main, and fails on a plugin with another range.
- [ ] The server suite and the sdk suite pass, one at a time.
- [ ] `docs/updates/v0_15.md` says both changes under *Upgrading*.
