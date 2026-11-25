---
title: A chat runs on an agent of its own - implemented
date: 2026-11-24
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - `createChat`"
  - "[code://packages/sdk/src/vscoderootconfig.ts](../../../../packages/sdk/src/vscoderootconfig.ts) - the root key"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) - an asleep chat's agent"
---

`createChat` takes a `provider` and makes the chat on that agent. `initialize` says `multipleChatProviders` while the root key is on, which it is by default.

## Verified

- `chat-own-agent.test.ts`: eight cases, a restart among them.
- The whole repository's `pnpm test`: 10527 cases pass. One case of `changes-refresh.test.ts` failed at random, since #452 reads a session's folder at its start, and its assertion is fixed here.

## Departures from the plan

- An agent that is off or paused is refused in the sentence its state uses, and not in VS Code's words.
- The caller's right to the agent, the policies and the session's machine are asked too. The plan did not say so, and a chat would have gone around all three.
- An asleep chat on another agent read its transcript from the session's agent. It reads its own agent's.
- `config.values` holds what the chat was given. The plan said the agent's defaults, which the schema carries.
