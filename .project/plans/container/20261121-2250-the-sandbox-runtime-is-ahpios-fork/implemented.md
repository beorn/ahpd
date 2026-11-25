---
title: The sandbox runtime is ahpio's fork - implemented
date: 2026-11-22
refs:
  - "[code://packages/computer/package.json#L68](../../../../packages/computer/package.json#L68) - `@ahpio/sandbox-runtime` at `0.0.83-rc.0`"
  - "[code://packages/computer/src/sandbox.ts#L165](../../../../packages/computer/src/sandbox.ts#L165) - the CLI under the new name"
  - "[code://packages/computer/src/sandbox.ts#L208-L213](../../../../packages/computer/src/sandbox.ts#L208-L213) - `denyWrite` always written"
  - "[code://pnpm-workspace.yaml](../../../../pnpm-workspace.yaml) - the runtime's zod raised to 4.6.6 or later"
  - "[code://packages/computer/test/sandbox-runtime-fork.test.ts](../../../../packages/computer/test/sandbox-runtime-fork.test.ts) - the gate, run for real on Linux"
  - "[code://.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) - bubblewrap, socat and ripgrep on the processes shards"
---

The computer plugin runs on `@ahpio/sandbox-runtime@0.0.83-rc.0`, ahpio's fork of Anthropic's runtime at `v0.0.83`, in place of VS Code's `@vscode/sandbox-runtime@0.0.1`. A chat that allows the whole network now reaches every host, and keeps its filesystem rules. The runtime's zod is 4.6.6 or later, so `pnpm audit` reports no advisory through it.

## What was built

- `ahpio/sandbox-runtime` - the fork with `network.enabled` and the zod range, PR #1 as `5ec7d8a`. Its `UPSTREAM.md` holds the passes that take upstream releases.
- npm - `0.0.83-rc.0` under `next`, published with provenance by the fork's `release.yml`, run 45039413969. `latest` is a `0.0.0` placeholder that let the trusted publisher be set.
- [`code://packages/computer/package.json`](../../../../packages/computer/package.json) - the dependency at one exact version, and Node `>=22.12.0`.
- [`code://packages/computer/src/sandbox.ts`](../../../../packages/computer/src/sandbox.ts) - the CLI and `SandboxManager` under the new name. The settings always carry `filesystem.denyWrite`, since 0.0.83 refuses a file without it.
- [`code://pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml) - an override that resolves the runtime's zod to `^4.6.6`. pnpm took zod 3.25.76 from the fork's range, and the advisory covers it.
- [`code://packages/agent-claude/package.json`](../../../../packages/agent-claude/package.json) - zod `^4.6.6`, so the whole tree loads one zod, 4.6.7. With the runtime's zod at 4.6.7 and agent-claude's at 4.5.4, two copies loaded and the Claude session CLI did not start.
- [`code://.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) - the `processes` shards, which run the computer tests, install bubblewrap, socat and ripgrep, and allow user namespaces.

## Verified

- `packages/computer/test/sandbox-runtime-fork.test.ts`, 3 cases on Linux with the real runtime. The whole network reaches a loopback host, and no allowed domain does not. A read denial holds with the whole network allowed. On CI a runtime that does not start fails the cases.
- The computer suite: 43 files, 666 passed and 1 skipped, with ripgrep on the `PATH`.
- `packages/sdk/test/containers.test.ts` and `container-relay.test.ts`: 17 passed.
- `pnpm audit`: no zod advisory is left in the tree.
- The full unit suite: 559 files, 9640 passed and 32 skipped.

## Departures from the plan

- The zod override in `pnpm-workspace.yaml` and the `denyWrite` default were not in task 03's files. Both were needed for the plan's checks to pass.
- agent-claude's zod range was not in task 03's files. One zod copy in the tree was needed for the Claude backend to start.
- The Linux CI step was not in task 03's files. Without it the end-to-end cases cannot run on CI.

## Left for later

- macOS and Windows run no end-to-end case in ahpd. The fork's own CI runs the gate on both.
