---
title: A client reads a listed plugin's details
status: done
depends: [task-02-a-client-reads-the-list.md]
layer: "server"
refs:
  - "[code://packages/server/src/pluginschannel.ts#L878-L889](../../../../packages/server/src/pluginschannel.ts#L878-L889) - where the command joins the others"
  - "[code://packages/server/src/plugins.ts#L561-L607](../../../../packages/server/src/plugins.ts#L561-L607) - `readManifest`, the fields read from an installed `package.json`, which the details read from a listed one"
  - "[code://packages/server/src/icons.ts#L333](../../../../packages/server/src/icons.ts#L333) - `fetchIcons`, which turns each icon into a `data:` URI"
---

## Objective

`x-ahpd/plugins/details {id, marketplace?, version?}` answers what a details page shows for a listed plugin, before an install.
The daemon fetches each file from the version's `files` once, keeps it on disk, and never sends a client to plugins.ahpio.com.

## Files

- `UPDATE: packages/server/src/pluginlist.ts` - `listedDetails`, the fetch and the files on disk.
- `UPDATE: packages/server/src/pluginschannel.ts:878-889` - the command `x-ahpd/plugins/details`.
- `UPDATE: packages/server/src/config.ts:966` - `pluginFilesPath`, beside `pluginMarketplacesPath`.
- `UPDATE: packages/server/test/pluginlist.test.ts` - the details over stubbed files.
- `UPDATE: docs/plugins/PLUGINS.md` - the command and its answer.

## Steps

1. Pick the entry: the named marketplace's entry for the id, or the first marketplace's.
2. Pick the version: the one named, or the newest listed version that fits the daemon.
3. Fetch `manifest`, `readme`, `changelog` and `license` from `files`, each when the version has it.
4. Keep each file at `plugin-files/<hash>/<id>/<version>/<name>`, and read it from there the next time. `<hash>` is the name of the marketplace's list file.
5. Refuse a file larger than 1 MB, and a URL that is not `https:`.
6. Answer `id`, `marketplace`, `version`, `versions`, `readme`, `changelog`, `license`, and from the manifest `contracts`, `links`, `optionsSchema`, `homepage`, `bugs` and `repository`.
7. Answer each icon of `files.icons` through `fetchIcons`, with the icon rules of an installed plugin.
8. Answer the parts it could fetch, with one `problem` for each part it could not.
9. Add `x-ahpd/plugins/details` with `plugin:list`, and document it in `PLUGINS.md`.
10. With `installed: true`, answer the `readme`, `changelog` and `license` of the package the configured plugin loads. Use no list for this. Refuse an id that is not configured.

## Validation

- The test answers the README and the contracts of a stubbed version, and a second call makes no request.
- Two marketplaces with one id keep their files apart.
- A version with no `changelog` answers no `changelog` and no problem.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/server/test/pluginlist.test.ts` passes.
- `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/server` passes.

## Resume

Built on 2026-11-15; awaits review.
`listedDetails` in `pluginlist.ts` answers each part it could not fetch as `{ part, problem }` in `problems`.
`x-ahpd/plugins/details {id: "agent-acp"}` on the test daemon answered 0.14.0 with its README, license, contracts, links and icons, and kept the files under `plugin-files/<list>/agent-acp/0.14.0/`.
After Softov's test, `details` with `{ id, installed: true }` reads the files of the installed package through `packageDirOf` and `installedFiles`. It works for a plugin from a list, a folder or a file. ahpw's installed page shows this README, not the list's.
