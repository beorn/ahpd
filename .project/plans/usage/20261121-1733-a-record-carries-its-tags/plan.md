---
title: A usage record carries the tags of what it passed through
domain: usage
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
requires:
  - plans/claude/20261121-1733-a-resumed-turn-pays-only-its-own-cost/plan.md
changes:
  - specs/usage.md
refs:
  - git://365db60ee06d88a30d81aa9a70c10e766036e56e:.project/briefs/a-usage-record-carries-the-tags-it-passed.md - the brief this plan covers
  - git://76ab8bbba2605c9bfa47cabc89fb262106aa3541 - the commit of `main` the facts were checked at
  - "[code://packages/sdk/src/types/usage.ts#L37-L80](../../../../packages/sdk/src/types/usage.ts#L37-L80) - `UsageBase`, which gets `tags`"
  - "[code://packages/sdk/src/types/usage.ts#L217-L228](../../../../packages/sdk/src/types/usage.ts#L217-L228) - `UsageKey` and `UsageGroup`, which get `tag`"
  - "[code://packages/sdk/src/types/agents.ts#L53-L108](../../../../packages/sdk/src/types/agents.ts#L53-L108) - `AgentRecord` and `AgentView`, which get `tags`"
  - "[code://packages/sdk/src/types/connectors.ts#L218-L229](../../../../packages/sdk/src/types/connectors.ts#L218-L229) - `Connector`, which gets `tags`"
  - "[code://packages/sdk/src/agents/channel.ts#L470-L500](../../../../packages/sdk/src/agents/channel.ts#L470-L500) - how the channel reads `description` and `icon` off a record, the pattern for `tags`"
  - "[code://packages/sdk/src/connectors/channel.ts#L353-L362](../../../../packages/sdk/src/connectors/channel.ts#L353-L362) - how the channel reads `title` off a record, the pattern for `tags`"
  - "[code://packages/sdk/src/usage/meter.ts#L203-L212](../../../../packages/sdk/src/usage/meter.ts#L203-L212) - `poolsOf`, which adds a key once, the pattern for the tag set"
  - "[code://packages/sdk/src/usage/meter.ts#L248-L282](../../../../packages/sdk/src/usage/meter.ts#L248-L282) - `write`, where an agent turn's record is made"
  - "[code://packages/sdk/src/usage/meter.ts#L105-L115](../../../../packages/sdk/src/usage/meter.ts#L105-L115) - how the meter reads `ahpd.cost` off a report's `_meta`, the pattern for `ahpd.connectors`"
  - "[code://packages/sdk/src/host/spawn.ts#L1211-L1226](../../../../packages/sdk/src/host/spawn.ts#L1211-L1226) - where the meter is made for a session"
  - "[code://packages/server/src/proxy/listener.ts#L1187-L1216](../../../../packages/server/src/proxy/listener.ts#L1187-L1216) - `record`, which writes a proxy call's record"
  - "[code://packages/sdk/src/usage/usage.ts#L486-L501](../../../../packages/sdk/src/usage/usage.ts#L486-L501) - `keysOf`, the group keys a record is summed under"
  - "[code://packages/agent-claude/src/logins.ts#L435-L465](../../../../packages/agent-claude/src/logins.ts#L435-L465) - `Login` and `loginsOf`, the login connectors a Claude turn runs on"
  - "[code://packages/agent-claude/src/session/query.ts#L1440-L1465](../../../../packages/agent-claude/src/session/query.ts#L1440-L1465) - where a Claude turn's usage `_meta` is made"
  - https://langfuse.com/docs/observability/features/tags - tags as a plain string array, checked 2026-11-21
  - https://docs.litellm.ai/docs/proxy/request_tags - tags on the spend record, checked 2026-11-21
---

## Goal

An agent record and a connector each hold a list of string tags.
Each usage record carries the tags of the agent, the connectors and the logins its work passed through, each tag once.
`usage://groups` groups and filters records by tag.
With this, two Claude agents, two logins or two connectors are told apart in the totals by a name the person chose.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "tags" packages/sdk/src/types` - no record type has tags.
- `rg -n "connector" packages/sdk/src/usage/meter.ts` - an agent turn's record names no connector.
- `rg -n "ahpd.account" packages/agent-claude/src` - the session's `_meta` names the account, and the usage report names no login.
- `grep '"agent"' ~/.config/ahpd/usage/2026-11-model.jsonl` - `agent` holds the agent record id, such as `claude-deepseek-build`.

### Runtime path

```
agent record tags ----------------------------\
claude login -> usage _meta ahpd.connectors -> meter.write -> tags of agent + each connector -> usage.record
proxy call -> connector tags -----------------> listener.record ------------------------------> usage.record
usage://groups?by=tag&tag=<t> | x-ahpd/usage/groups -> store.groups -> keysOf -> one group per tag
```

### Gaps

- `AgentRecord`, `AgentView` and `Connector` have no `tags`.
- `UsageBase` has no `tags`.
- A Claude turn does not say which login ran it.
- `UsageKey` has no `tag`.
- `ahpd usage` has no grouping; `usage://groups` and `x-ahpd/usage/groups` do.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tag is a plain string, and a record keeps each tag once | Softov, 2026-11-21, "then an agent and a connector get a 'string' tag", picked "Plain strings (Recommended)" | 01, 02 |
| An agent record and a connector hold tags | Softov, 2026-11-21, "an agent and a connector get a 'string' tag" | 01 |
| A tag that is already on the record is not added again | Softov, 2026-11-21, "if duplicated, just ignore" | 02 |
| A Claude turn's record takes the tags of each login it ran on | Softov, 2026-11-21, "tag the 'connector' and can know the connector user onto the login" | 03 |
| A tag is a label only, and no policy matches a tag in this plan | Softov, 2026-11-21, picked "Not now (Recommended)" | - |
| A model gets no tags in this plan | `(defaulted: the record names the model in model.name already)` | - |
| Tags are on the usage record only, not on the turn's `_meta` | `(defaulted: no client asked to show them)` | - |
| A record keeps the tags it was written with | `(defaulted: the same rule as pools, in decisions/a-limit-counts-the-records-tagged-with-its-key.md)` | 02 |
| A tag is 1 to 64 characters, with no comma and no control character, and a list holds at most 32 | `(defaulted: a comma would break the tag list of a query, and the limit keeps a record small)` | 01 |
| The order is the agent's tags, then each connector's in the order used | `(defaulted: the order they were passed)` | 02 |
| A backend names the connectors a turn used in its usage `_meta` as `ahpd.connectors`, and the host reads their tags | `(defaulted: the host reads connector records already, and a backend then never copies tags)` | 02, 03 |
| `by=tag` puts a record in one group for each of its tags, and a record with no tag in none | `(defaulted: the shape a multi-valued label has in Langfuse and LiteLLM)` | 04 |
| Grouping by tag goes on `usage://groups` and `x-ahpd/usage/groups`, and `ahpd usage` gets no new flag | `(defaulted: ahpd usage has no grouping today; grouping lives in the resource)` | 04 |

## Proposed architecture

- **Data flow** - the meter takes a `tagsOf(turn)` option. Spawn gives it the agent view's tags and the tags of each connector id in the report's `ahpd.connectors`. The proxy adds the serving connector's tags.
- **State flow** - tags live on the agent record and the connector record. A record copies them when it is written, and never reads them again.
- **Layer responsibilities** - sdk: the types, the channels, the meter, the store and `keysOf` · agent-claude: `ahpd.connectors` on the usage report · server: the proxy record.
- **Source-of-truth files** - [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - agents-and-connectors-hold-tags](task-01-agents-and-connectors-hold-tags.md) | done | - |
| [02 - a-record-takes-the-tags-it-passed](task-02-a-record-takes-the-tags-it-passed.md) | done | 01 |
| [03 - claude-names-the-logins-it-ran-on](task-03-claude-names-the-logins-it-ran-on.md) | done | 02 |
| [04 - usage-filters-and-groups-by-tag](task-04-usage-filters-and-groups-by-tag.md) | done | 02 |

## Risks and tradeoffs

- The cost plan and the fork's `host/124` branch also change `parts.ts` and `query.ts` - this branch stacks on the cost plan's branch.
- `maycxc/plugin/54-webhook-real-senders` changes `Connector` - rebase over it before task 01 is merged.
- A client shows no tag field until it reads `tags` from the record - the channels send `tags`. A client change is out of this plan.

## Resume state

- **Done so far:** tasks 01 to 04, 2026-11-21, in [implemented.md](implemented.md).
- **Next action:** none. Merged on 2026-11-21.
- **Watch out for:** `agent` on a record is the agent record id. `AgentView` is live, so read the tags when the record is written.

## Final verification checklist

- [ ] Two agent records with different tags write records with those tags.
- [ ] A Claude turn that failed over to a second login carries both logins' tags.
- [ ] A proxy call carries its connector's tags.
- [ ] `usage://groups?by=tag` and `tag=<t>` answer from the same store and reader rule as today's keys.
- [ ] `pnpm typecheck`, `pnpm lint`, and the sdk, server, agent-claude and computer suites pass.
- [ ] `specs/usage.md` says what `tags` holds and where each tag comes from.
