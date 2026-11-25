---
title: A pi agent takes a baseUrl and an apiKey - implemented
date: 2026-11-10
refs:
  - git://3512e3888
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - the endpoint provider of an agent"
---

A pi agent runs on any OpenAI-compatible endpoint, as a cofold agent can, with a `baseUrl` and an `apiKey`. PR #276 merged it on 2026-11-10.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `baseUrl` and `apiKey` register one provider under the agent's id on each session's runtime. Its models come from `<baseUrl>/models`, as `<id>/<model>`, and each probe reads them again.
- [`code://packages/agent-pi/src/plugin.ts`](../../../../packages/agent-pi/src/plugin.ts) - the two options on the plugin or on the agent, the agent's value first. `apiKey` is kept in the vault.
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - the endpoint.

## Verified

- `agent-pi-endpoint.test.ts`: an agent named like one of pi's providers replaces it for its own sessions only. An endpoint with no key runs turns with no `Authorization` header. A failed listing answers no models, and a probe waits up to 10 s. CI passed on #276.

## Departures from the plan

- None recorded.

## Left for later

- None.
