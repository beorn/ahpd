---
title: An install takes a listed version
status: done
depends: [task-01-the-daemon-keeps-the-list-on-disk.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L264-L289](../../../../packages/server/src/install.ts#L264-L289) - `fittingVersion`, which gets the list's versions as a second source"
  - "[code://packages/server/src/install.ts#L619-L627](../../../../packages/server/src/install.ts#L619-L627) - the install's call, the return of a non-registry source at L619, and the manifest request at L623"
  - "[code://packages/server/src/install.ts#L763-L768](../../../../packages/server/src/install.ts#L763-L768) - the `ahpd` field check after npm runs, where the list check goes"
  - "[code://packages/server/src/install.ts#L849-L850](../../../../packages/server/src/install.ts#L849-L850) - the update leaves a `github:` spec as installed"
  - "[code://packages/server/src/install.ts#L865](../../../../packages/server/src/install.ts#L865) - the update's call"
  - "[code://packages/server/src/install.ts#L880-L890](../../../../packages/server/src/install.ts#L880-L890) - the update's npm run, and the versions it moved from"
  - "[code://packages/server/src/selfupdate.ts#L474-L490](../../../../packages/server/src/selfupdate.ts#L474-L490) - `checkPlugins`, which reads the list through `fittingVersion` as the update does"
  - "[code://packages/server/src/pluginschannel.ts#L498-L512](../../../../packages/server/src/pluginschannel.ts#L498-L512) - `x-ahpd/plugins/install`, which gets `marketplace`"
---

## Objective

An install or an update of a listed plugin picks its version from its marketplace's list, with the rule `fittingVersion` has for npm.
The install then checks the package against the list's `integrity` or `commit`, and removes it when they differ.
The daemon keeps the marketplace of each installed plugin in `installed.json`.
A listed `github:` plugin installs at its version's commit and does not update in this plan.

## Files

- `UPDATE: packages/server/src/pluginlist.ts` - `listedVersions` and `installed.json`.
- `UPDATE: packages/server/src/install.ts:264-289` - `fittingVersion` takes the versions from the list when the name is listed.
- `UPDATE: packages/server/src/install.ts:619-627` - a listed `github:` source pins the commit, and a listed version skips the manifest request.
- `UPDATE: packages/server/src/install.ts:763-768` - the check after the install's npm run.
- `UPDATE: packages/server/src/install.ts:880-890` - the check after the update's npm run.
- `UPDATE: packages/server/src/pluginschannel.ts:498-512` - `marketplace` in `x-ahpd/plugins/install`.
- `UPDATE: packages/server/test/plugin-install.test.ts` - the listed cases.

## Steps

1. Add `listedVersions(source, marketplace?)` in `pluginlist.ts`, which answers the versions of the named marketplace's entry for the source, or nothing.
2. With no marketplace named, use the marketplace in `installed.json` for the source, then the first marketplace that lists the source.
3. Accept an npm name and a `github:` source alike; a source that no marketplace lists installs as today.
4. Add an optional `marketplace` to `x-ahpd/plugins/install`, and refuse a marketplace that `pluginMarketplaces` does not name.
5. In `fittingVersion`, use `listedVersions` when it answers, and the npm packument otherwise, with the same rule.
6. The list has no `latest`, so the newest listed version is the upper limit in place of `dist-tags.latest`.
7. Skip a listed prerelease, as the npm path does, so the list can serve prereleases later.
8. Skip a listed version that has `deprecated`.
9. `checkPlugins` in `selfupdate.ts` reads the list through `fittingVersion`, so its check and the move after it read the same versions.
10. For a listed `github:` source, install `github:<owner>/<repo>#<commit>` of the chosen version, at `install.ts:619`, before the source returns as written.
11. Skip the manifest request at `install.ts:623` for a listed version. The check at `install.ts:763-768` reads the manifest after npm runs.
12. After npm runs, read the installed package's `integrity` from `node_modules/.package-lock.json` for an npm source.
13. Read the installed commit from the same file's `resolved` for a `github:` source.
14. When an install's value differs from the list, remove the package. Refuse with both values and the list's URL.
15. When the value differs on an update, put back the version the package moved from, and refuse with both values.
16. When no listed version fits the daemon, refuse with the newest version and its `sdk`, as npm does.
17. Write the package and its marketplace to `installed.json` after an install, and remove the package's entry after a remove.
18. Leave a listed `github:` plugin as installed on an update, as `install.ts:849-850` does; its update is a later plan.

## Validation

- An install of a listed name takes the list's version, with no request to npm before npm runs.
- An install with a stubbed wrong `integrity` refuses, names both values, and leaves no package behind.
- An update with a stubbed wrong `integrity` refuses and leaves the version it moved from.
- An install that names the second of two marketplaces takes that marketplace's versions, and `installed.json` names it.
- An install of a name the list does not have reads npm, as before.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server/test/plugin-install.test.ts` passes.
- `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` passes.

## Resume

Built on 2026-11-15; awaits review.
`ahpd plugin install` takes `--marketplace <url>`, and `x-ahpd/plugins/install` takes `marketplace`.
`newestFitting` in `compat.ts` is the one rule for npm's versions and a list's. `listedMismatch` reads `node_modules/.package-lock.json` after npm runs.
`checkPlugins` and `movePlugins` in `selfupdate.ts` read the lists through `fittingVersion`, and `ahpd update` passes them.
`plugin-install.test.ts` passes 78 cases. A real `ahpd plugin install @ahpd/agent-acp` in a scratch home took 0.14.0 from the live list, matched npm's integrity, and wrote `installed.json`.
