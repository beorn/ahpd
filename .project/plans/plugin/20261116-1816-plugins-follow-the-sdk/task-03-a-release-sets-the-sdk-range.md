---
title: A release sets each plugin's sdk range
status: done
depends: []
layer: scripts
refs:
  - "[code://scripts/boundary.mjs](../../../../scripts/boundary.mjs) - a root check that CI runs as `pnpm boundary`, the shape the new script copies"
  - "[code://packages/sdk/test/plugin-boundary.test.ts](../../../../packages/sdk/test/plugin-boundary.test.ts) - the test of that check, where the new test sits beside it"
  - "[code://.github/workflows/ci.yml#L47](../../../../.github/workflows/ci.yml#L47) - the boundary step of `check`"
  - "[code://.github/workflows/ci.yml#L120](../../../../.github/workflows/ci.yml#L120) - the boundary step of `check-windows`"
  - "[code://.github/workflows/release.yml#L112](../../../../.github/workflows/release.yml#L112) - the boundary step of the release"
---

## Objective

Each published plugin declares `"@ahpd/sdk": ">=<sdk version> <<next minor>.0-0"` in `peerDependencies`, from the version in `packages/sdk/package.json`.
One script writes the ranges at a bump, and CI and the release refuse a range that differs.

## Files

- `CREATE: scripts/sdk-range.mjs` - with `--write`, sets each plugin's range; without it, prints each plugin whose range differs and exits 1.
- `UPDATE: package.json:27` - a `sdk-range` script beside `boundary`.
- `UPDATE: .github/workflows/ci.yml:47` - `check` runs `pnpm sdk-range` after `pnpm boundary`.
- `UPDATE: .github/workflows/ci.yml:120` - `check-windows` runs it too.
- `UPDATE: .github/workflows/release.yml:112` - the release runs it before the tests.
- `UPDATE: packages/agent-acp/package.json` - the range set by the script.
- `UPDATE: packages/agent-claude/package.json` - the range set by the script.
- `UPDATE: packages/agent-cofold/package.json` - the range set by the script.
- `UPDATE: packages/agent-pi/package.json` - the range set by the script.
- `UPDATE: packages/activepieces/package.json` - the range set by the script.
- `UPDATE: packages/bot/package.json` - the range set by the script.
- `UPDATE: packages/computer/package.json` - the range set by the script.
- `UPDATE: packages/push/package.json` - the range set by the script.
- `UPDATE: packages/tasks/package.json` - the range set by the script.
- `UPDATE: packages/tunnel-devtunnel/package.json` - the range set by the script.
- `UPDATE: packages/webhook/package.json` - the range set by the script.
- `CREATE: packages/sdk/test/sdk-range.test.ts` - the cases of the script.

## Steps

1. Write `scripts/sdk-range.mjs` with no dependency, as `boundary.mjs` is.
2. Read the sdk's version, and compute the range `>=<version> <<major>.<minor + 1>.0-0`.
3. Take as a plugin each package under `packages/` that is not private and has `@ahpd/sdk` in `peerDependencies`.
4. With `--write`, set each plugin's range, and keep the rest of each file byte for byte.
5. Without `--write`, print `<package>: <range>, not <expected>` for each plugin that differs, and exit 1.
6. Add `"sdk-range": "node scripts/sdk-range.mjs"` to the root `package.json`.
7. Run `pnpm sdk-range` in `check`, in `check-windows` and in the release, each after `pnpm boundary`.
8. Run `node scripts/sdk-range.mjs --write`, and commit the 11 ranges at `>=0.15.0-rc.3 <0.16.0-0`.
9. Write `sdk-range.test.ts` over a folder of fixture packages.

## Validation

- `sdk-range.test.ts`: the range of `0.15.0-rc.4` is `>=0.15.0-rc.4 <0.16.0-0`, and of `1.2.3` is `>=1.2.3 <1.3.0-0`.
- The same test: `--write` changes only the ranges of the plugins, and a check after a write passes.
- The same test: the check names a plugin at `>=0.14 <1` and exits 1.
- `node scripts/sdk-range.mjs` exits 0 on the branch.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/sdk` passes.
- CI runs the step in `check` and `check-windows`.

## Resume

Built on 2026-11-16, awaiting review.

- The 11 ranges are `>=0.15.0-rc.3 <0.16.0-0`. The rc.4 bump runs `node scripts/sdk-range.mjs --write`, or CI fails.
- `plugin-compat.test.ts` held each range at `>=0.14 <1`; it checks the release range now.
- `computer-devcontainer.test.ts` loaded the computer plugin as sdk `0.14.4`, which the new range refuses; it loads it as the workspace sdk now.

