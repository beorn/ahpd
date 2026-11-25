---
title: ahpd speaks AHP 1.1.0 - implemented
date: 2026-11-21
refs:
  - git://dfe5b8492
  - "[code://packages/sdk/src/host/channels.ts](../../../../packages/sdk/src/host/channels.ts) - the `ahp-annotations:` names"
  - "[code://packages/sdk/src/host/canvases.ts](../../../../packages/sdk/src/host/canvases.ts) - a canvas's `uri`, with `url` beside it"
  - "[code://packages/sdk/src/host/chatconfig.ts](../../../../packages/sdk/src/host/chatconfig.ts) - the checks on a chat's own config"
  - "[code://packages/agent-claude/src/session/context.ts](../../../../packages/agent-claude/src/session/context.ts) - the list of steering messages"
---

ahpd installs AHP 1.1.0 and speaks its wire. A client that offers 1.1.0 agrees on it. The per-chat config reads the package's types, and Claude keeps a list of steering messages. A model's `vendor` reaches the client, a canvas says `uri`, and a session's annotations channel is `ahp-annotations:`. The protocol's own 1.1.0 cases run through the host.

## What was built

- [`code://package.json`](../../../../package.json) - every range is `^1.1.0`, in the root and eight packages.
- [`code://tools/ahp-test-cases.mjs`](../../../../tools/ahp-test-cases.mjs) - reads the published version from `clients/typescript/package.json`, where the 1.1.0 tag keeps it. The cases in `packages/sdk/test/fixtures/ahp-test-cases` are the v1.1.0 copy.
- [`code://packages/sdk/src/host/chatconfig.ts`](../../../../packages/sdk/src/host/chatconfig.ts) - VS Code's three checks. The vendored types and reducer are gone, and `chat/configChanged` goes through the package's chat reducer.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `chat/configChanged` goes to a client on any version, and a mark goes to both annotations names.
- [`code://packages/sdk/src/host/canvases.ts`](../../../../packages/sdk/src/host/canvases.ts) - `uri`, and the same value as `url`, on each action and snapshot.
- [`code://packages/server/src/wire.ts`](../../../../packages/server/src/wire.ts) - the wire log redacts both source keys.
- [`code://packages/sdk/src/host/channels.ts`](../../../../packages/sdk/src/host/channels.ts) - `annotationsChannelOf`, `sessionOfAnnotations` and `annotationsChannelsOf`.
- [`code://packages/sdk/src/host/annotationssummary.ts`](../../../../packages/sdk/src/host/annotationssummary.ts) - `annotations` on the session's state and row.
- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - `meantBy` makes an `ahp-annotations:` name again from the published session.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - a steer appends to the list, and each read removes its own entry.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - 1.1.0, the canvas, the annotations channel, `chat/configChanged` and `chat/moved`.

## Verified

- `pnpm typecheck`, `pnpm boundary` and `pnpm schema` pass.
- The sdk suite passes, 5090 cases, and the server suite 1982.
- The agent-claude suite passes, 688 cases.
- The other packages pass 2420 cases. Two dev container cases time out at 5 s on this machine, on the commit before task 09 too, as [computer-cases-time-out-on-a-busy-machine.md](../../../problems/computer-cases-time-out-on-a-busy-machine.md) says.
- The protocol's 1.1.0 cases pass, 771, with the documented idle drains.
- `pnpm docs:build` passes.

## Departures from the plan

- Tasks 02 and 03 were dropped: main had per-chat config already.
- A canvas sends `url` beside `uri`, as VS Code main does, where the plan said no `url`.
- `chat/configChanged` passes the version filter. The 1.1.0 package registers it at `1.1.0`, and VS Code's host holds back only `chat/moved`.
- `createChat` keeps its untyped `params`, as every session method reads them.
- The annotations cases went into `host-snapshots.test.ts`, beside their siblings.

## Left for later

- ahpw reads a canvas's `url` in `src/resources/sessions/SessionHeader.tsx:114`, which works while `url` is sent. Reading `uri` first is an ahpw change.
- The rest of 1.1.0 is in the-rest-of-ahp-1-1-0.md (`git://a3118737e`, now the six `20261124` plans).
