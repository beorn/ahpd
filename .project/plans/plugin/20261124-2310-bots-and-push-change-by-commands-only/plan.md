---
title: Bots and push devices change by commands only
domain: plugin
status: active
priority: medium
created: 2026-11-24
revalidated: 2026-11-24
requires:
  - plans/plugin/20261116-1940-bots-and-push-take-commands/plan.md
refs:
  - "[code://packages/bot/src/plugin.ts#L672](../../../../packages/bot/src/plugin.ts#L672) - where the `bot` provider is registered, with its write and delete"
  - "[code://packages/push/src/plugin.ts#L167](../../../../packages/push/src/plugin.ts#L167) - where the `push` provider is registered, with its write and delete"
  - "[code://packages/bot/src/commands.ts#L53-L66](../../../../packages/bot/src/commands.ts#L53-L66) - the bot commands, which call the provider write and delete"
  - "[code://packages/push/src/channel.ts#L72-L99](../../../../packages/push/src/channel.ts#L72-L99) - the push commands, which call the same two"
  - "[code://packages/sdk/src/host/resourcemethods.ts#L194-L231](../../../../packages/sdk/src/host/resourcemethods.ts#L194-L231) - what a write answers for a provider that has none"
---

## Goal

A client changes a bot and a push device with the commands alone. `resourceWrite` and `resourceDelete` on `bot://` and `push://` are refused, so one road has the checks. Reads, lists and watches stay.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -nE "BOT_PUT|PUSH_PUT"` in ahpw and ahpapp - both send the commands where the host lists them, and write resources otherwise.
- `git grep -nE "bot://|push://"` in ahpc - none.
- `grep -rlE "resourceWrite|resourceDelete" packages/*/test` - the bot, push and server cases that write by resource.

### Runtime path

```
client x-ahpd/bots/put -> host gate -> bot method -> provider.write -> store -> channel
client resourceWrite bot:// -> storeFor -> no write -> refused
```

### Gaps

- Both providers are registered whole, so both roads are open.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The older writes and deletes go in 0.16, and reads stay | Softov, 2026-11-24, chose "Remove writes and deletes" | 01 |
| The refusal has the host's code for a scheme with no write, and names the command | `(defaulted: ahpw reads the advertised put)` | 01 |
| The clients keep their fallback for an older host | `(defaulted: they read the command list, and a host before 0.15 has no commands)` | - |

## Proposed architecture

- **Layer responsibilities** - bot and push plugins: register the provider with a `write` and a `delete` that refuse, and give the whole one to the commands.
- **Source-of-truth files** - [`code://packages/bot/src/plugin.ts`](../../../../packages/bot/src/plugin.ts), [`code://packages/push/src/plugin.ts`](../../../../packages/push/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the two schemes are read only](task-01-the-two-schemes-are-read-only.md) | done | - |
| [02 - the documents say it](task-02-the-documents-say-it.md) | done | 01 |

## Risks and tradeoffs

- An ahpapp or ahpw older than its command support cannot change a bot or a device - the release notes name it.

## Resume state

- **Done so far:** both tasks, 2026-11-24.
- **Next action:** the review.
- **Open questions:** none.
- **Watch out for:** the commands call `provider.write`, so the methods stay on the provider.

## Final verification checklist

- [ ] The whole suite passes.
- [ ] ahpw makes, edits and deletes a bot on the test daemon, and registers a device.
