---
title: The notes say how to upgrade
status: done
depends: [task-01-the-shipped-sdk-is-the-gate.md, task-02-a-prerelease-sdk-takes-prereleases.md, task-03-a-release-sets-the-sdk-range.md]
layer: docs
refs:
  - "[code://docs/updates/v0_15.md#L20](../../../../docs/updates/v0_15.md#L20) - the 0.15.0 *Upgrading* section"
  - "[code://docs/plugins/PLUGINS.md#L1561](../../../../docs/plugins/PLUGINS.md#L1561) - what the `@ahpd/sdk` range states"
  - "[code://docs/plugins/PLUGINS.md#L2176](../../../../docs/plugins/PLUGINS.md#L2176) - how an install picks a listed version"
---

## Objective

The 0.15 notes and the plugin guide state the rule of this plan, and tell a tester what to run after an upgrade.

## Files

- `UPDATE: docs/updates/v0_15.md:20` - two items under *Upgrading*.
- `UPDATE: docs/plugins/PLUGINS.md:1561` - the range is checked against the sdk the daemon ships, and a first-party plugin's range ends at the next minor.
- `UPDATE: docs/plugins/PLUGINS.md:2176` - a daemon whose sdk is a prerelease also takes the prereleases a range admits.

## Steps

1. Add to *Upgrading* in `v0_15.md`: after `ahpd update` from 0.14.0 or to a release candidate, run `ahpd plugin update all`, then restart.
2. Give the reason in the same item: the update runs the old daemon's code.
3. Say in the same item that a 0.14.0 backend does not import on sdk 0.15.
4. Add a second item: a first-party plugin's range runs from the sdk of its release to the next minor.
5. Say in that item that the loader refuses a plugin of an older minor, and `plugin update` moves it.
6. Correct the range row of `PLUGINS.md` at line 1561 to name the sdk the daemon ships, and the first-party range.
7. Correct the paragraph at line 2176 to say which prereleases a daemon takes.
8. Run `pnpm docs:build`, and fix each broken link it reports.

## Validation

- The two items read in the 0.15.0 section of `docs/updates/v0_15.md`.
- `rg -n "prerelease" docs/plugins/PLUGINS.md` shows the new rule and no old one.
- The plan's *Final verification checklist* follows the item from rc.3 to rc.4.

## Resume

Built on 2026-11-16, awaiting review.

- The rule is under a new heading, *Choosing a version*, in `docs/plugins/PLUGINS.md`, and the notes link to it.
- `docs/server/PLUGINS.md` said a plugin moves to the version that fits the daemon; it says the sdk the daemon ships now.
- `pnpm docs:build` passes, after `pnpm build`.

