---
title: The ahpd part's plugins install from a lock
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L840-L860](../../../../packages/computer/src/parts.ts#L840-L860) - the plugins are installed by `ahpd plugin install`"
  - "[code://packages/computer/src/hostinstall.ts#L117](../../../../packages/computer/src/hostinstall.ts#L117) - the box installs them the same way"
  - "[code://packages/server/src/install.ts#L570](../../../../packages/server/src/install.ts#L570) - why a plugin root is installed with `--legacy-peer-deps`"
---

## Objective

The plugins of the published ahpd part are installed by `npm ci` from a committed lock, in the image and on a box.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `lockOf` answers the ahpd part's four files, and `dockerfileOf` installs the plugin root with `npm ci`.
- `UPDATE: packages/computer/src/hostinstall.ts` - the script writes the four files and installs the plugin root with `npm ci`, so it takes no plugin arguments.
- `UPDATE: scripts/parts-bump.mjs` - `lock` writes the plugin lock of the ahpd part.
- `CREATE: packages/computer/images/parts/ahpd/plugins/package.json` - the sdk and the part's plugins at the part's version.
- `CREATE: packages/computer/images/parts/ahpd/plugins/package-lock.json` - npm's lock of them.
- `UPDATE: packages/computer/test/computer-parts.test.ts` - the lock case covers the plugin lock.
- `UPDATE: packages/computer/test/computer-hostinstall.test.ts` - the stand-in npm answers for two folders.
- `UPDATE: packages/computer/test/parts-bump.test.ts` - the locks case expects the plugin lock.
- `UPDATE: docs/plugins/COMPUTERS.md` - *Parts* and *The ahpd on the box* say both installs use a lock.
- `UPDATE: .project/specs/nested-hosts.md` - the published part installs its plugins from a lock.

## Steps

1. Write the plugin lock in `lock` with `npm install --package-lock-only --legacy-peer-deps`.
2. Give `lockOf` the four files for the ahpd part, the plugin pair named `plugins/<file>`.
3. Replace `ahpd plugin install` in `dockerfileOf` with `fromLock` on `PLUGIN_ROOT` and `--legacy-peer-deps`.
4. Replace it in the box script with the same `npm ci`.
5. Run `node scripts/parts-bump.mjs --locks`, and keep only the new ahpd files.
6. Correct the spec and the docs.

## Validation

- A shipped plugin lock names the sdk and each plugin at the part's version.
- The Dockerfile checks each of the four files against its sum.
- A box with the stand-in npm runs `npm ci` in both folders, and the key moves when the plugin lock moves.
- Build the part with `node --conditions development --import ./scripts/dev.mjs scripts/parts-publish.mjs --local`, and run a cofold session in a machine with it.

## Resume

Done on 2026-11-25. A box in a container installed both locks from npm, and its ahpd loaded agent-cofold. Not run: a cofold session in a machine with the part.
