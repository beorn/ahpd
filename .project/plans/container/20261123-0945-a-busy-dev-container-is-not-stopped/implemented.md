---
title: A dev container a session runs in is not stopped - implemented
date: 2026-11-23
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `occupants`, and the folder's `stop` and `remove`"
---

A session placed with `computer://<id>` on a dev container's machine keeps it when a client stops or removes the folder's dev container. The computer plugin answers `false`, "it is still in use", while any session runs in the machine.

## What was built

- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - `occupants`, the sessions of every machine, from `enter` and `leave`. The folder's `stop` and `remove` answer `false` while the machine has one.

## Verified

- `computer-devcontainer.test.ts`: a new case, a session entered by `computer://box` keeps the folder's stop and remove from acting, and the stop acts once the session leaves. It fails without the change.
- The computer suite passes. `pnpm typecheck` passes.

## Departures from the plan

- The case that stops a folder after its session is disposed now waits for the stop to answer `true`. The host says a session left only after it brings the session's work back, a moment after the dispose answers. A stop before that would take a machine whose commits are not fetched yet.

## Left for later

- `x-ahpd/computers/stop` on a busy machine still stops it, as the plan's open question proposed.
