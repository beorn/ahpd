---
title: The chat has its agent's own config
status: done
depends: [02]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1833-L1840](../../../../packages/sdk/src/host/sessionmethods.ts#L1833-L1840) - the config a new chat takes"
  - "[code://packages/sdk/src/host/chatconfig.ts](../../../../packages/sdk/src/host/chatconfig.ts) - the checks on a chat's own config"
---

## Objective

A chat on another agent has `config.schema`, its agent's session schema, and `config.values`, that agent's defaults. A write to its config is checked against its own schema.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1833-1840` - start the chat with its agent's schema and defaults.
- `UPDATE: packages/sdk/src/host/chatconfig.ts` - check a write against the chat's own schema when it has one.
- `UPDATE: packages/sdk/test/chat-own-agent.test.ts` - the config cases.

## Steps

1. Ask the chat's agent for its session config schema and defaults, as a new session of that agent does.
2. Put them on the chat as `config.schema` and `config.values`.
3. Give a fork or side chat its source chat's own schema and values.
4. Check a `chat/configChanged` against the chat's own schema when it has one.
5. Add cases: the schema and values of a new chat on another agent, a valid write, and a refused write.

## Validation

- `chat-own-agent.test.ts`: the config cases.
- Run the sdk suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-24. No source changed: the state, the schema and the check were built for a plugin's chat. `chatConfigOf` gives the config it starts with. A key with no value takes the schema's default, as 1.1.0 says.
