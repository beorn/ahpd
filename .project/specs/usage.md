---
title: Usage
status: current
covers:
  - packages/sdk/src/types/usage.ts
  - packages/sdk/src/usage/meter.ts
  - packages/sdk/src/usage/usage.ts
  - packages/server/src/commands/usage.ts
  - packages/server/src/proxy/listener.ts
refs:
  - "[code://packages/sdk/src/types/usage.ts#L23-L95](../../packages/sdk/src/types/usage.ts#L23-L95) - `Cost`, `UsageBase`, `ModelUse` and `ComputerTime`"
  - "[code://packages/sdk/src/types/usage.ts#L130-L199](../../packages/sdk/src/types/usage.ts#L130-L199) - the `Usage` port and the grouped total"
  - "[code://packages/sdk/src/usage/meter.ts#L100-L115](../../packages/sdk/src/usage/meter.ts#L100-L115) - `costOf`, the cost a harness reported"
  - "[code://packages/sdk/src/usage/meter.ts#L193-L197](../../packages/sdk/src/usage/meter.ts#L193-L197) - `poolsOf`, the owner, team and project pools"
  - "[code://packages/sdk/src/usage/meter.ts#L228-L325](../../packages/sdk/src/usage/meter.ts#L228-L325) - the agent meter, per turn or per report"
  - "[code://packages/sdk/src/usage/usage.ts#L137-L387](../../packages/sdk/src/usage/usage.ts#L137-L387) - `fileUsage`, the monthly JSONL files and the totals in memory"
  - "[code://packages/sdk/src/usage/usage.ts#L642-L669](../../packages/sdk/src/usage/usage.ts#L642-L669) - `refused`, `visible` and `keeper`, which pools a reader may read"
  - "[code://packages/sdk/src/usage/usage.ts#L619-L895](../../packages/sdk/src/usage/usage.ts#L619-L895) - `usageProvider`, the `usage:` scheme"
  - "[code://packages/sdk/src/usage/usage.ts#L928-L976](../../packages/sdk/src/usage/usage.ts#L928-L976) - `usageMethods`, the `x-ahpd/usage/*` commands"
  - "[code://packages/sdk/src/usage/scopes.ts#L139-L152](../../packages/sdk/src/usage/scopes.ts#L139-L152) - `mayRead`, the pools a person reads with no grant"
  - "[code://packages/server/src/proxy/listener.ts#L233-L244](../../packages/server/src/proxy/listener.ts#L233-L244) - `costOf`, the cost a configured price gives"
  - "[code://packages/server/src/proxy/listener.ts#L668-L698](../../packages/server/src/proxy/listener.ts#L668-L698) - the record of a gateway call"
  - "[code://packages/computer/src/plugin.ts#L846-L874](../../packages/computer/src/plugin.ts#L846-L874) - `close`, the record of a machine's up time"
  - "[code://packages/server/src/config.ts#L40-L60](../../packages/server/src/config.ts#L40-L60) - `UsageSetting`, `usage.per` and `usage.timezone`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-model-record-with-no-model-named-has-an-empty-name, a-record-keeps-the-providers-cost-beside-the-charged-one, agent-usage-is-charged-to-owner-team-and-project-pools, an-agent-says-whose-cost-report-counts, the-agent-meter-writes-per-turn-or-per-report, the-usage-store-answers-live-totals, usage-and-computer-time-are-two-records-behind-one-port, usage-is-grouped-by-the-host, usage-is-read-through-a-usage-scheme, usage-lists-the-charged-pools-a-reader-may-read
---

Usage is the record of model use and computer time, so that a person, a team or a project sees what its work cost.
Three writers send records to one `usage` port: the model gateway, the agent meter and the computer plugin.
Each record names the pools it is charged to, and the store keeps a live total per pool.
The default store `fileUsage` is in [`code://packages/sdk/src/usage/usage.ts`](../../packages/sdk/src/usage/usage.ts), and a plugin can replace it with `registerUsage`.
Clients read usage through the `usage:` scheme, the `x-ahpd/usage/*` commands, `ahpd usage` and `/api/usage/<pool>`.
Nothing here limits work: a pool is a key, and what a pool allows belongs to policy.

## Scenarios

### Two kinds of record behind one port

WHEN a writer records usage
THEN the record is a model record with `kind: model`, or a computer record with `kind: computer`
AND both have one base: `at`, `source`, `owner`, `team`, `project`, `session`, `chat`, `turn`, `agent`, `computer`, `cost`, `providerCost`, `token`, `meta`, `pools` and `tags`.
A model record adds `model` with the name, provider and token counts, and a computer record adds `seconds`.
A gateway call made with a key adds `token` and `meta`.
`token` is the id of the key, and `meta` is the map of names to values the key and the call named.
This is so that a list by agent or by computer is a filter on one record, not a join.

### The tags a record carries

WHEN the meter writes an agent turn's record
THEN `tags` holds the agent record's tags, then the tags of each connector the turn's usage named in `_meta['ahpd.connectors']`, each tag once
AND a Claude turn names the login it ran on, and each login a failover moved it to.
WHEN the model gateway writes a call's record
THEN `tags` holds the tags of the connector that served the call.
A record copies the tags when it is written, so an edit to a tag changes no record already kept.
A record with no tag has no `tags` field.
A tag is a label only, and charges no pool.

### The pools a record is charged to

WHEN the meter or the model gateway writes a record
THEN it charges the owner as written, such as `user:<id>` or `root:<host>`
AND it adds `team:<team>` and `project:<team>:<project>` from the scope the work is charged under.
Each pool is named only when the record has it, so work with no owner and no scope is charged to no pool.
A project pool is told from a team pool by its prefix, not by a count of colons.

### The agent meter writes one record per turn

WHEN a turn ends as completed, cancelled or failed
THEN the meter writes one model record with the turn's last report, because each report is a running sum for the turn
AND a turn that reported nothing writes no record.
The owner is the person who sent the turn, else the owner of the session.

### The agent meter writes one record per report

WHEN the daemon config sets `usage.per` to `report`
THEN the meter writes a record for each `chat/usage` report, with what the report added since the one before it
AND a pool's total moves while a long turn runs.
The records of one turn add up to the same total as one record per turn.
A count that came down is written as its new value, so a harness that counts again gives too much, not too little.

### A report that comes late

WHEN a usage report arrives for a turn that the meter saw end
THEN the meter does not write it again
AND a report for a turn that never said it began is metered from the report and the moment it arrived.

### A record with no model named

WHEN a turn's report names no model and the turn asked for none
THEN the meter writes the record with `model.name` as an empty string
AND the tokens and the cost stay in the record.
A reader shows an empty name as an unknown model.

### The cost an agent reported

WHEN a harness reports a cost in `_meta['ahpd.cost']`
THEN the meter writes it as both `cost` and `providerCost`, with `from: harness` and the currency in lowercase
AND it keeps the split into sent and received when the harness gave one.
A cost of 0 on a turn that counted no token is no cost, so the record has none.
A cost that is not known is absent, never 0.

A Claude turn's cost is the change in the CLI's running total since the last `result`.
WHEN a Claude query resumes a session on this host
THEN the running total starts at the last `cost-state` line of the session's transcript.
WHEN a fork, a rewind or a session in a machine resumes, or the transcript holds no `cost-state` line
THEN the first `result` has no cost
AND each `result` after it is charged its change from that first one.

### The model gateway charges a configured price

WHEN a call through the model gateway uses a `modelGateway.models` entry that has a `price`
THEN the record's `cost` is that price in dollars per million tokens, with `from: price`
AND `providerCost` is the provider's own figure, when the provider reported one.
A call with no price is charged what the provider said it cost.
This is so that a host can charge a different amount from what it pays.

### Computer time

WHEN a machine stops, is removed or restarts, or the daemon stops
THEN the computer plugin writes one computer record for the stretch the machine was up
AND it charges the machine's owner, team and project.

### The default store

WHEN a record is written to `fileUsage`
THEN it is appended to `<configDir>/usage/<YYYY-MM>-<kind>.jsonl` at mode `0600`
AND each write waits behind the one before it, so two lines never mix
AND the store adds the record to a total per pool per day in memory, which it builds from the files at start.
A record with no readable date is reported and kept nowhere.

### A live total

WHEN a reader asks for a pool's total between two moments
THEN the store answers from the totals in memory, compared at the day
AND a day that is partly in the range counts whole.
`usd` adds only costs in US dollars, and `providerUsd` adds the providers' figures beside it.

### The usage scheme

WHEN a client lists `usage://`
THEN the host answers the pools that have records, limited to the pools the reader may read
AND a pool nothing was charged to is not listed, for root or for anyone else.
This is so that root and a member see the same row for the same work.

### What a pool reads

WHEN a client reads `usage://<pool>`
THEN it gets the pool's kind, name, day, week and month
AND `range` gives a total between `from` and `until`, and `records` gives the newest 200 records in the range.
A pool name holds colons, so it is one encoded path segment, such as `usage://project%3Abackend%3Asearch`.
A range with no bounds is the first day of the month and now, and a bound that is not a date is refused.

### Day, week and month

WHEN the host cuts a day, a week or a month
THEN it uses the zone in `usage.timezone`, else the zone of the system
AND a week starts on Monday.

### Who reads a pool

WHEN a signed-in person reads a pool
THEN they read their own `user:` pool and the pools of their teams and projects with no grant
AND any other pool needs `usage:read`, and a refusal is -32009.
The root connection, and a host with no users file, read every pool.

### A grouped total

WHEN a client reads `usage://groups?by=user,team,project` with a range
THEN the host sums each record once by the keys asked, with the team and project names beside the keys
AND it counts a record only when the reader may read at least one of its pools.
WHEN the client asks `by=tag`
THEN a record is in one row for each of its tags, and a record with no tag is in none.
WHEN the client names `tag=<a>,<b>`
THEN the host sums only the records that hold every tag named.
The host sums the records, because a client that reads 200 records at a time cannot sum a busy month.
