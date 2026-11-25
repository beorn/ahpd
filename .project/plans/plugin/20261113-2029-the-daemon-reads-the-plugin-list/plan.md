---
title: The daemon reads the plugin list
domain: plugin
status: built
priority: medium
created: 2026-11-13
revalidated: 2026-11-15
refs:
  - https://github.com/softov/ahpio-site/blob/main/.project/plans/plugins/20261113-2029-ahpio-serves-the-plugin-list/plan.md - the ahpio-site plan that serves the list and its format, built before this one
  - "[code://packages/server/src/update.ts#L22-L23](../../../../packages/server/src/update.ts#L22-L23) - the update check's file and its age, the shape the list's file copies"
  - "[code://packages/server/src/update.ts#L135-L144](../../../../packages/server/src/update.ts#L135-L144) - `refreshUpdate`, one quiet request whose every failure leaves the file as it was"
  - "[code://packages/server/src/update.ts#L155-L156](../../../../packages/server/src/update.ts#L155-L156) - `checkingUpdates`, which turns the npm check off under `CI`, as the list fetch is"
  - "[code://packages/server/src/commands/run.ts#L2380-L2384](../../../../packages/server/src/commands/run.ts#L2380-L2384) - the background timer that asks again, let go of with `unref`"
  - "[code://packages/server/src/config.ts#L966](../../../../packages/server/src/config.ts#L966) - `updatePath`, where the list's path goes beside it"
  - "[code://packages/server/src/commands/options.ts#L1008-L1013](../../../../packages/server/src/commands/options.ts#L1008-L1013) - `updateCheck`, the setting the two new ones sit beside"
  - "[code://packages/server/src/commands/configure.ts#L339-L367](../../../../packages/server/src/commands/configure.ts#L339-L367) - the questions `ahpd configure` asks"
  - "[code://packages/server/src/commands/plugin.ts#L86-L100](../../../../packages/server/src/commands/plugin.ts#L86-L100) - `plugin.list`, a registry action that the CLI and the HTTP API both serve"
  - "[code://packages/server/src/pluginschannel.ts#L878-L889](../../../../packages/server/src/pluginschannel.ts#L878-L889) - the plugin channel's commands by name"
  - "[code://packages/server/src/pluginschannel.ts#L306-L343](../../../../packages/server/src/pluginschannel.ts#L306-L343) - a plugin row, its id by `pluginIdOf(spec, where)` and its alerts"
  - "[code://packages/server/src/icons.ts#L333](../../../../packages/server/src/icons.ts#L333) - `fetchIcons`, which turns an `https:` icon into a `data:` URI within the daemon's icon bounds"
  - "[code://packages/server/src/install.ts#L264-L289](../../../../packages/server/src/install.ts#L264-L289) - `fittingVersion`, which reads the npm packument today"
  - "[code://packages/server/src/install.ts#L619-L627](../../../../packages/server/src/install.ts#L619-L627) - the install's call to `fittingVersion`, the return of a non-registry source before it, and the manifest request after it"
  - "[code://packages/server/src/install.ts#L865](../../../../packages/server/src/install.ts#L865) - the update's call to `fittingVersion`"
  - "[code://packages/server/src/selfupdate.ts#L474-L490](../../../../packages/server/src/selfupdate.ts#L474-L490) - `checkPlugins`, which asks `fittingVersion` for each installed plugin before a self-update"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md) - where the plugin channel's commands are documented"
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/workbench/contrib/chat/common/plugins/pluginMarketplaceService.ts#L679 - VS Code joins the plugins of every marketplace, and each keeps its `marketplace`
  - https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/workbench/contrib/chat/common/plugins/fileBackedInstalledPluginsStore.ts#L33-L50 - VS Code keeps each installed plugin's marketplace in `installed.json`
---

## Goal

The daemon fetches the plugin lists of its marketplaces, plugins.ahpio.com by default, keeps them on disk, and serves them to clients.
A client shows each listed plugin with its marketplace, whether it is installed, and its details before an install.
An install of a listed plugin takes the newest version in its marketplace's list that fits the daemon, and checks it against the list.
The list and its format are the ahpio-site plan [plugins.ahpio.com serves the plugin list](https://github.com/softov/ahpio-site/blob/main/.project/plans/plugins/20261113-2029-ahpio-serves-the-plugin-list/plan.md), which is built first.
The auto-update, the held-back version, the update of a `github:` source and the install progress are later plans.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "plugins.json|pluginList" packages/server/src` - nothing; the daemon has no list.
- `rg "fittingVersion\(" packages/server/src` - the install, the update and `checkPlugins` in `selfupdate.ts` call it, each with the npm packument.
- `rg "x-ahpd/plugins/install" docs` - `docs/plugins/PLUGINS.md` and the 0.14 notes.
- `docs/server/REFERENCE.md` - generated from the code, so a new setting and a new action appear there with no edit.
- `curl https://plugins.ahpio.com/v1/plugins.json` on 2026-11-15 - 200 with an `ETag`, 304 on `If-None-Match`, `version: 1`, 3 plugins and 25 versions, two with `deprecated`, and no `github:` source.

### Runtime path

```
start + every pluginCheckHours, not under CI -> GET each of pluginMarketplaces (If-None-Match, User-Agent) -> plugin-marketplaces/<hash>.json on disk
client -> x-ahpd/plugins/available -> every marketplace's entries + installed rows -> entries with marketplace, icons as data: URIs, and installed
client -> x-ahpd/plugins/details {id, marketplace?, version?} -> files URLs -> plugin-files/<hash>/<id>/<version>/ on disk -> readme, changelog, manifest
client -> x-ahpd/plugins/install {source, marketplace?} -> listed? versions from that list : npm packument -> npm install -> integrity or commit check -> installed.json
```

### Gaps

- No setting names a list, and nothing fetches one.
- No command answers a plugin that is not installed.
- `fittingVersion` reads only npm, and an install checks nothing against a list.
- `updatePlugins` leaves a `github:` spec as installed, so a listed `github:` plugin does not update in this plan.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The list is on by default; `[]` turns the marketplaces off | Softov, 2026-10-25: "yes" | 01 |
| A daemon reads several marketplaces in order, ours by default | Softov, 2026-11-15: "Several, in order" | 01 |
| Each marketplace's entries are listed, two with the same id included, and each entry names its marketplace, as VS Code does | Softov, 2026-11-15: "List both, as VS Code" | 01, 02, 03, 04 |
| The setting is `pluginMarketplaces`, as VS Code names `chat.plugins.marketplaces` | Softov, 2026-11-15: "pluginMarketplaces" | 01 |
| A setting holds the URLs, `https://plugins.ahpio.com/v1/plugins.json` by default, and `ahpd configure` asks for it | Softov, 2026-10-25 | 01 |
| The default URL carries the format version, `/v1/plugins.json`, so a later format is served beside it | Softov, 2026-11-14: "/ahpd/plugins/v1.json" | 01 |
| The default URL is `https://plugins.ahpio.com/v1/plugins.json` | Softov, 2026-11-14: "/v1/plugins.json" | 01 |
| The list is at its own host, `plugins.ahpio.com`, which moves by DNS apart from the site | Softov, 2026-11-14: "plugins.ahpio.com" | 01 |
| The fetch is off under `CI`, as the npm update check is | Softov, 2026-11-15: "Off under CI, as the update check" | 01 |
| A listed prerelease is skipped; a prerelease mode for a daemon or a plugin is a later plan | Softov, 2026-11-14: "something we could see to support latter" | 03 |
| A listed version with `deprecated` is never installed or updated to; a plugin row that runs one shows the message | Softov, 2026-11-14: "Keep it, marked" | 02, 03 |
| The list fetch and the auto-update share one period, 12 hours by default | Softov, 2026-10-25 | 01 |
| The period is a setting outside `ahpd configure` | Softov, 2026-10-25: "does not need to be on ahpd configure" | 01 |
| The fetch sends `User-Agent: ahpd/<version>` | Softov, 2026-10-25: "Yes for the User-Agent" | 01 |
| The fetch sends no telemetry | Softov, 2026-10-25: "No telemetry for now" | 01 |
| The list is a registry action and a plugin channel command; each entry says if its id is installed | Softov, 2026-10-25 | 02 |
| An entry is installed when an installed package is its source, and else when an installed plugin has its id | Softov, 2026-11-15: "Match by source, then by id" | 02 |
| `available` answers each icon as a `data:` URI that the daemon fetched and keeps on disk | Softov, 2026-11-15: "Daemon fetches, answers data: URIs" | 02 |
| A details command answers the README, contracts, links and options schema of one entry | Softov, 2026-10-25 | 04 |
| A client never contacts plugins.ahpio.com or the registry; the daemon fetches and keeps the files | Softov, 2026-10-25 | 02, 04 |
| `fittingVersion` reads a listed plugin's versions from the list, and an unlisted one's from npm | Softov, 2026-11-13 | 03 |
| An install by source with no marketplace reads the first marketplace that lists the source, npm or `github:`; a source no marketplace lists installs as today | Softov, 2026-11-15: "first marketplace, but it could also accept npm and github as source?" | 03 |
| An installed plugin's marketplace is kept in `plugin-marketplaces/installed.json`, as VS Code keeps `installed.json` | Softov, 2026-11-15: "A file, as VS Code's installed.json" | 03 |
| A listed `github:` plugin does not update in this plan; its update is a later plan with the auto-update of a git source | Softov, 2026-11-15: "Later plan, said in task 03" | 03 |
| An install refuses a package whose integrity or commit differs from the list | Softov, 2026-11-13 | 03 |
| The period setting is `pluginCheckHours` | `(defaulted: beside updateCheck, in its style)` | 01 |
| Each list's file is in `plugin-marketplaces/` in the configuration folder, named by a hash of its URL, with its `ETag` | `(defaulted: beside update.json)` | 01 |
| A details file is kept under `plugin-files/<hash>/<id>/<version>/` and never fetched again | `(defaulted: a version's files never change)` | 04 |
| `x-ahpd/plugins/available` and `details` need `plugin:list` | `(defaulted: the grant that reads the plugin channel)` | 02, 04 |
| `details` with `installed: true` answers the files of the installed package | Softov, 2026-11-15: "the plugin detail is the readme already present onto the system also, if any and no marketplace." | 04 |

## Proposed architecture

- **Data flow** - `pluginlist.ts` fetches and reads the lists. The action, the channel commands and the install read them from disk, never from the network.
- **Event flow** - At start, the daemon fetches each list whose file is older than the period. A timer let go of with `unref` fetches again. Under `CI` it fetches nothing.
- **State flow** - Each file in `plugin-marketplaces/` holds one list, its URL, its `ETag` and `checkedAt`. A fetch that fails leaves it as it was. `installed.json` maps each installed package to the marketplace it came from.
- **Layer responsibilities** - `pluginlist.ts`: fetch, read, files, `installed.json` · `install.ts`: the listed versions and the check · `commands/plugin.ts`: the action · `pluginschannel.ts`: the commands and the row's alert.
- **Source-of-truth files** - [`code://packages/server/src/pluginlist.ts`](../../../../packages/server/src/pluginlist.ts) once written.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The daemon keeps the list on disk](task-01-the-daemon-keeps-the-list-on-disk.md) | done | - |
| [02 - A client reads the list](task-02-a-client-reads-the-list.md) | done | 01 |
| [03 - An install takes a listed version](task-03-an-install-takes-a-listed-version.md) | done | 01 |
| [04 - A client reads a listed plugin's details](task-04-a-client-reads-a-listed-plugins-details.md) | done | 02 |

## Risks and tradeoffs

- A list with a wrong `integrity` blocks every install of that version - the install says the list and npm differ, and names both values.
- A proxy that blocks plugins.ahpio.com leaves the daemon with no list - the install by name works, and `available` says why it is empty.
- Files fetched for details fill the disk over time - each file is at most 1 MB, and only the versions a client opened are kept.
- A version with no `sdk` range fits every daemon, as on npm today - an example is agent-acp 0.0.1. The list's `since` drops such versions, which is a change to the list and not to this plan.
- A hand edit of `plugins` does not update `installed.json` - the install ignores an entry whose package is gone. An installed package with no entry reads the first marketplace that lists it.

## Resume state

- **Done so far:** tasks 01 to 04 are built on branch `plugin/20261113-2029-the-daemon-reads-the-plugin-list` in `/github/ahpd.worktrees/plugin-list` on 2026-11-15, not committed. Each task's *Resume* says what ran and where the build differs from its steps.
- **Next action:** none. The plan is `built`, closed on 2026-11-20 with the 0.15.0 release, which Softov counted as its review.
- **Open questions:** none.
- **Found in Softov's test of 2026-11-15:** `x-ahpd/plugins/remove` gave npm the row's id, such as `web`, in place of the package, `@ahpd/web`. Every `npm uninstall` also ran without `--legacy-peer-deps`, so a root with an older plugin failed with ERESOLVE. Both are fixed on the branch, each with a test.
- **Found in the build:** the list's ids are not the ids ahpd gives the first-party plugins. None exports a `name`, so ahpd calls `@ahpd/agent-acp` `ahpd-agent-acp`, and the plugins repository's check strips the scope to `agent-acp`. `available` matches by source first for this reason. The check is in the plugins repository, and is not changed here.
- **Watch out for:** the tests stub the fetch; no test reaches plugins.ahpio.com. A spawned test daemon has `CI=1` from `daemonEnv`, which keeps it off the network.

## Final verification checklist

- [ ] A fresh daemon writes one file in `plugin-marketplaces/`, and a restart within 12 hours does not fetch again.
- [ ] A daemon with `CI` set fetches nothing.
- [ ] `"pluginMarketplaces": []` fetches nothing, and `available` answers no marketplaces.
- [ ] A second marketplace with an id ours has gives a second entry with its own `marketplace`, and an install from it reads its versions.
- [ ] `ahpd plugin available` prints each listed plugin with its marketplace, with the installed ones marked.
- [ ] An install of `@ahpd/agent-acp` takes its version from the list, writes `installed.json`, and a stubbed list with a wrong `integrity` refuses it.
- [ ] `x-ahpd/plugins/details {id: "agent-acp"}` answers the README of the version that fits the daemon.
- [ ] `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` and the server suite pass.
