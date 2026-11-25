---
title: A talk that cannot open is no talk
domain: plugin
status: built
priority: high
created: 2026-11-19
revalidated: 2026-11-19
requires: []
changes: []
creates: []
decisions: []
refs:
  - git://6ad28f5ec - the commit of ahpd this plan was checked at
  - "[code://packages/sdk/src/plugins/plugins.ts#L1516-L1560](../../../../packages/sdk/src/plugins/plugins.ts#L1516-L1560) - `sessionKept`, which reads the store only, and `sessionOwner`, which also asks `opens`"
  - "[code://packages/sdk/src/types/plugin.ts#L1180-L1225](../../../../packages/sdk/src/types/plugin.ts#L1180-L1225) - the two methods on `PluginHost`, where `sessionOpens` goes beside them"
  - "[code://packages/sdk/src/host/automations.ts#L1094-L1095](../../../../packages/sdk/src/host/automations.ts#L1094-L1095) - `opensSession`, the check `opens` makes: running now, or restored from its catalogue"
  - "[code://packages/sdk/src/host/history.ts#L371](../../../../packages/sdk/src/host/history.ts#L371) - `restoreSession`, which finds nothing for a stored session whose transcript has no turn"
  - "[code://packages/bot/src/talks.ts#L90-L127](../../../../packages/bot/src/talks.ts#L90-L127) - `botTalks`, where `kept` decides that a person still has a talk"
  - "[code://packages/bot/src/plugin.ts#L555-L562](../../../../packages/bot/src/plugin.ts#L555-L562) - the talks' `kept` seam, wired to `host.sessionKept`"
  - "[code://packages/computer/src/plugin.ts#L1545](../../../../packages/computer/src/plugin.ts#L1545) - the computer plugin's startup check, which keeps `sessionKept` as it is"
  - "[code://packages/sdk/test/plugin-session-owner.test.ts](../../../../packages/sdk/test/plugin-session-owner.test.ts) - the real host the `sessionOwner` cases fold a plugin into, the pattern for the `sessionOpens` cases"
  - "[code://packages/bot/test/bot-provider.test.ts#L1376-L1404](../../../../packages/bot/test/bot-provider.test.ts#L1376-L1404) - the cases of one talk for each bot and person"
---

## Goal

A bot no longer hands a person a talk session that the host cannot open.
On 2026-11-19 Softov clicked Open chat on the bot Ember. The page said the session no longer existed. Ember's talk was made on 2026-11-16 with no message, and the daemon restarted since. The host keeps the session's record but cannot open a session with no turn after a restart, so a subscribe answers `-32001 No agent for session`. The bot still counts that session as Softov's talk, so a new chat is refused naming it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- On the test daemon, Solar's talk, made with no message at 03:26 on 2026-11-19, answers `-32001 No agent for session` to a subscribe after a restart.
- Ember's row in `bots/ember/fronts/` names `ahp-session:/cdcb2084-396f-4fae-9b53-0a1ef21aebe3`. The session's record is in `sessions/`, with provider `bot-chat`. No log of the bot names it.
- `sessionOwner` already answers nothing for such a session, through `opens`. `sessionKept` reads the store only.
- The bot decides that a person has a talk by `sessionKept`, in `of` and in `all`.
- The computer plugin removes a leftover disposable machine when `sessionKept` answers `false`. A session in a machine that is not adopted yet may not open at that time, so `sessionKept` keeps its meaning.

### Searches performed

- `rg -n "sessionKept|sessionOwner" packages --glob '!**/dist/**'` - the bot, the computer, the push and the webhook plugins, the sdk, and `docs/plugins/PLUGINS.md`.
- `rg -n "No agent for session" packages/sdk/src` - the snapshot of a stored session answers it when `restoreSession` finds no turn.

### Runtime path

```
Open chat -> bot read answers the talk -> talks.of -> host.sessionKept (store row: true) -> subscribe -> restoreSession (no turn) -> -32001
```

### Gaps

- No method tells a plugin whether the host can open a session, apart from an owner.
- The bot's talks trust a store row that outlives its session.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The bot stops handing out a talk the host cannot open, in place of the host opening an empty session | Softov, 2026-11-19: "You can plan it using the sessionKept also. since its your recommendation." | 01, 02 |
| `sessionKept` keeps its meaning, and the host gains `sessionOpens(uri)`, which the bot's talks ask | Softov, 2026-11-19: "New sessionOpens, bot uses it" | 01, 02 |
| `sessionOpens` asks `opens`; with no host built over the plugin, it answers the store's row | (defaulted: a session a plugin just started has no config row, and `opens` checks the name) | 01 |
| A talk whose session does not open is not the person's talk, so Open chat makes a new one, and the old row is written over when it is kept | (defaulted: `keep` writes a row over the one there was) | 02 |
| The reopen of talks a restart left open keeps `sessionKept`, since a talk with an open turn has a log and its subscribe restores it | (defaulted: no change where the answer is the same) | 02 |
| The line in the 0.15.0 notes goes under *Bots* and *Plugins and connectors* | (defaulted: a fix of the working day, before 0.15.0) | 02 |
| A talk is a session the store keeps with its config and the host can open, so an old log with no record is no talk | Softov, 2026-11-19: "build it, PR, merge when green", after #386 took Ember's old log as his talk | 03 |

## Proposed architecture

- **Data flow** - `sessionOpens(uri)` reads the store's row for the URI's name, as `sessionKept` does, then asks `starts.opens`. The bot's talk seam `opens` calls it.
- **Layer responsibilities** - sdk: `PluginHost.sessionOpens` · bot: `TalkSeams.opens` in place of `kept` · computer: unchanged.
- **Source-of-truth files** - [`code://packages/sdk/src/plugins/plugins.ts`](../../../../packages/sdk/src/plugins/plugins.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the host says whether a session opens](task-01-the-host-says-whether-a-session-opens.md) | done | - |
| [02 - a bot talk is one that opens](task-02-a-bot-talk-is-one-that-opens.md) | done | 01 |
| [03 - a talk is kept and opens](task-03-a-talk-is-kept-and-opens.md) | done | 02 |

## Risks and tradeoffs

- `sessionOpens` restores a session to answer, which reads its transcript. The bot asks it once for each row of a bot at a snapshot, as `all` asks `sessionKept` today.
- A talk that had no message is dropped, and its record stays in the store. Nothing was said in it, so nothing is lost.

## Resume state

- **Done so far:** tasks 01 and 02, merged in #386 as `69571e844` on 2026-11-19, green on the first run.
- **Task 03:** merged in #387 as `b44c3e520`. Its first run failed one cofold case on Windows, fixed in #388 (`8cb8946fd`), and its second run was green.
- **Next action:** none. Softov's check passed on 2026-11-19; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the computer plugin must keep `sessionKept`; a `false` there removes a machine and its volume.

## Final verification checklist

- [x] After a restart, Open chat on Ember opens a new talk, and the page shows it.
- [x] A second create for the same person is refused naming the new talk.
- [ ] A talk with a message still opens after a restart.
- [x] The sdk, bot, computer, push and webhook suites pass, one at a time, and `check` and `check-windows` are green.
