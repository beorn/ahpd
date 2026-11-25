# Usage

**Usage** is what this host writes down about the work it did, and what a **pool** has been charged for it. A record is written once and never edited, and it is read back through a scheme of its own - `usage:` - rather than a command, so a client uses the resource calls it already has. What it is not is an enforcement: nothing here refuses anything, and the rows that decide who may use which agent, model and computer are [POLICY.md](POLICY.md).

Terms, one line each:

| Term | |
| --- | --- |
| a usage record | One thing that was spent - a model call, or a stretch of computer time |
| a pool | The name a record is charged to: a person, a team, a project, or a policy limit |
| a policy key | The key a charge walk adds for a limit that paid: `policy:<id>/<measure>` or `pool:<name>/<measure>`, with `/user:<id>` for an `each` limit |
| the owner | Who the work belongs to, as a typed reference - `user:<id>`, `team:<name>`, `project:<team>:<project>` or `root:<host>` |
| the store | Where the records are kept and what a pool has been charged |
| the charged cost | What the pools are charged, in US dollars |
| the provider's cost | What the provider or the harness reported, kept beside the charged one |
| the split | A cost reported in two parts, what the tokens sent cost and what the tokens received cost |

## What a record is

Two kinds share one base and one port. A **model call** is `kind: 'model'`, written by the model gateway for a call through `/v1` (`source: 'gateway'`) or by the agent meter for a turn a session's own harness ran (`source: 'agent'`). **Computer time** is `kind: 'computer'`, a stretch a machine was up, written against the machine's owner.

Every record carries when it happened, what wrote it, who it belongs to and where it ran: the owner, the team and the project it is charged under, the session, the chat and the turn, the agent provider, and the computer when there was one. The base is the same for both kinds, so a listing by agent or by computer is a filter and never a join. A gateway call also carries `meta`, what the key and the call said about themselves such as `env=prod` or `client=pi`. It carries `token` as well, the id of the key that made it when one did.

A record also carries `tags`, the labels of what the work passed through, each once. An agent record and a connector each take a `tags` list on their put, and a record copies the agent's tags, then each connector's: the login a Claude turn ran on, or the provider connector that served a gateway call. A backend names the connectors a turn used in its usage `_meta['ahpd.connectors']`. The tags are copied when the record is written, so a tag edited later changes no record already kept. A tag is 1 to 64 characters with no comma, and a list holds at most 32.

A model record carries the model's `<maker>/<name>`, the provider it ran on, and the tokens in three parts: `input`, `output`, and `cache` split into what was read from and written to the provider's cache. A pool's `tokens` is all three added together, because those are the tokens that were billed, and the three counts are kept apart as well so a report can say what was sent and what came back. A model record also carries `opens: true` when it is the first record the meter wrote for its turn, which is what a pool's `turns` counts. A turn written once and a turn written per report both open once, so `turns` counts one however many records the turn has, while `calls` counts every record.

### The two costs

`cost` is what the pools are charged and `providerCost` is what the provider or the harness reported, and they are two fields because they are two different things. A cost carries `from`, which says which of the two worked it out: `price` when this host computed it from a price list, `harness` when the agent or the provider reported it.

A call the model gateway priced is charged that price and keeps the provider's figure beside it. An agent's harness calls its model itself, so the figure it reported is both what the pools are charged and what the provider reported. A cost of `0` on a turn that counted no token is a harness saying it spent nothing, which is no cost at all: it is left off rather than written as `0`, because a record of `0` there would charge a pool for a call that never happened.

A harness that priced what was sent and what was received apart says so beside the amount, and those two parts are the **split**. They are kept as `input` and `output` on the cost, and a pool's `inputUsd` and `outputUsd` add them over the records that have them - a measure nothing was charged in is absent rather than zero, so a total over records that never split says nothing about the split rather than saying it was nothing.

## Pools

A record names the pools it is charged to, and `pools` on the record is the whole of it: the owner, `team:<name>`, `project:<team>:<project>`, and one key for each policy limit that paid for the work. Each is named only when the record has it, so work with no owner and no scope is charged to no pool rather than to one whose name says nothing.

A policy key is `policy:<id>/<measure>`, or `pool:<name>/<measure>` when the row names a `pool`, and an `each` limit adds `/user:<id>`. The keys a record carries are the ones its check chose, so a shared limit has one key for the whole group and an each limit has one per member. To the store a policy key is a pool like any other: `usage://` lists it to a reader holding `usage:read`, and `usage://<policy-key>` reads its totals. A person reads the limits that apply to them through [`usage://limits`](#limits) rather than by naming a key.

The store keeps a **live total** per pool per day, rebuilt when it starts up, because a limit is checked before a call and debited as usage arrives - an answer read off the month's file would be a total from before the last few seconds. A day is the granularity, which is exact for the ranges a limit asks about and counts a partly covered day whole. A day is the local day in `usage.timezone`, so a period summed over it holds no record from the period before.

## What a pool reads

Through the `usage:` scheme, at the root and one leaf under the pool.

| URI | What it answers |
| --- | --- |
| `usage://` | The pools a record was charged to that this reader may read, as directory entries |
| `usage://<pool>` | That pool as `{ pool, kind, name, day, week, month }`, the last three each a total |
| `usage://<pool>/day`, `/week`, `/month` | One of those periods on its own |
| `usage://<pool>/range?from=&until=` | One total between two days |
| `usage://<pool>/records?from=&until=` | The records charged to it, newest first, at most the newest 200 |
| `usage://groups?by=&from=&until=&tag=` | The records between two days summed by user, team, project and tag, one row per set of key values |
| `usage://limits` | Each active policy whose scope holds the reader, with its limits, what each used and when it resets |

A listing is the same for every reader: the pools the store has records for, limited to the pools the reader may read. Root and a member see the same row for the same pool, and a pool nothing was charged to is listed for neither, so a team or project that spent nothing has no row until its first record.

A pool name holds colons, so it is one encoded path segment: `usage://project%3Abackend%3Asearch` is the pool `project:backend:search` and not an authority called `project`. A record naming no instant is kept nowhere and said out loud, which is the only answer that is not a charge in the wrong place. A request for a leaf that is not one of the five is `-32008`.

### A pool's kind and name

`kind` is the pool key's prefix: `user`, `team`, `project` or `root`. `name` is what a person reads the pool by: the user's id, the team's title, `<team title> / <project title>`, or the host of a `root:` pool. Each title falls back to its id, so `project:backend:ahpapp` is `Backend / ahpapp` when the team has the title `Backend` and the project has none. The titles come from the people directory, and a reader needs no `team` or `project` grant to get them: only the title goes out, and only for a pool the reader may read.

### A range

`range`, `records` and `groups` take `from` and `until`, each a day as `2026-10-01` or an ISO 8601 instant, and compare them at the day as the totals do. A bound left out is the first day of the current month in the configured zone, and now. A bound that is not a date is `-32602`, rather than a range of every record or of none. `range` and `records` over the same `from` and `until` agree: the records are the ones that total summed.

### Groups

`usage://groups` sums the records of a range by the keys in `by`, a comma-separated list of `user`, `team`, `project` and `tag`. It answers one row per distinct set of key values:

```json
[
  {
    "keys": { "team": "team:backend", "project": "project:backend:ahpapp" },
    "names": { "team": "Backend", "project": "Backend / ahpapp" },
    "total": { "usd": 5, "calls": 2 }
  }
]
```

Each key is spelled as the pool key the record is charged under: `user` is the owner, which is `root:<host>` for a root connection's work, `team` is `team:<team>` and `project` is `project:<team>:<project>`. A key the records had none of is left out of `keys`, so team work grouped by `team,project` is a row with a `team` and no `project`. Each name is the pool's name as above. A `by` naming another key is `-32602`, and no `by` at all is one row for the whole range.

By `tag`, a record is in one row for each of its tags, and a record with no tag is in none; a tag's name is the tag. `tag`, a comma-separated list, keeps only the records that hold every tag in it.

A record counts once in a group, however many pools it is charged to, where a pool row counts it once under each of its pools. A record counts when the reader may read at least one pool it is charged to, so a member grouping by `user` sees their team's spending split by person. The store reads the month files for this, which is slower than a pool total over a long range, and a store plugin answers the same call.

The three periods are ranges in the configured zone rather than in UTC, so a week starts on the deployment's Monday 00:00 and not the evening before - see the `timezone` key below. `until` is always now, so the day behind the current hour is a partly covered one and is counted whole. The records a period's total summed are the records that period's `records` leaf lists, because both compare the range at the day.

### Limits

`usage://limits` is a read at the scheme's root, like `groups`, and not a pool. It answers one entry for each active policy whose scope holds the reader: `all`, the reader, or a team or project of theirs. The shape is the one `policy://<id>/limits` answers, and each limit carries its amount, what the period used, where the period began and when it resets.

```json
[
  {
    "id": "A2",
    "kind": "agent",
    "scope": "team:backend",
    "limits": [
      {
        "amount": 20,
        "measure": "usd",
        "period": "week",
        "pool": "each",
        "counted": true,
        "from": "2026-10-19T04:00:00.000Z",
        "resets": "2026-10-26T04:00:00.000Z",
        "used": 30
      }
    ]
  }
]
```

An `each` limit answers only the reader's own figure, as `used` and never `members`; `policy://<id>/limits` answers every member, because its reader holds `policy:read`. A person reads their own without a grant. A reader with no person, which is the root connection or a host with no users directory, reads `[]`. With `policies.ownLimits` off the read is `-32008`, and so it is on a host with no policies store. The rows and their figures are [POLICY.md](POLICY.md#reading-a-limit).

## Reading usage by command

Each read above is also an `x-` command a client sends on its connection, which answers the same value as JSON rather than as text in a `data` string. The `usage:` scheme stays, and both answer from the same functions. Usage has no channel: nothing is sent when a record is written.

| Command | Params | Answers what this read answers |
| --- | --- | --- |
| `x-ahpd/usage/pools` | none | `usage://`, as `[{ pool, kind, name }]` |
| `x-ahpd/usage/totals` | `pool` | `usage://<pool>`, as `{ pool, kind, name, day, week, month }` |
| `x-ahpd/usage/range` | `pool`, `from?`, `until?` | `usage://<pool>/range` |
| `x-ahpd/usage/records` | `pool`, `from?`, `until?` | `usage://<pool>/records` |
| `x-ahpd/usage/groups` | `by?`, `from?`, `until?`, `tag?` | `usage://groups` |

`pool` is the pool key as written, `user:ana`, not encoded. `from` and `until` are strings with the defaults and the refusals of [a range](#a-range). `by` is a list, `["user", "team"]`, rather than a comma-separated string, and a key that is not one of the three is refused with the sentence the read gives. A param of the wrong type is `-32602`.

```json
{ "id": 7, "method": "x-ahpd/usage/groups", "params": { "by": ["user"] } }
```

```json
{ "id": 7, "result": [{ "keys": { "user": "user:ana" }, "names": { "user": "ana" }, "total": { "calls": 2, "providerUsd": 4, "usd": 4 } }] }
```

Each command needs `usage:read`, and lets in a reader without it by the rules under [Grants](#grants): `pools` and `groups` let in every signed-in reader and answer only what that reader may read, and `totals`, `range` and `records` let a reader in for a pool they may read. Another person's pool is `-32009`, `<id> may not usage:read here`, as the read is. The five are listed on the handshake under `_meta['ahpd.methods']`.

## Configuration keys

Both keys are in the daemon's configuration file, under `usage`. Neither has a flag, because both are properties of a deployment rather than of one run.

| Key | Values | Default | What changes |
| --- | --- | --- | --- |
| `usage.per` | `turn` or `report` | `turn` | `turn` holds the running sum a harness reports and writes one record when the turn ends. `report` writes one record for every usage report, each holding what that report added since the one before it, so a long turn is billed while it is still running. A turn written per report still counts one turn, because only its first record opens it |
| `usage.timezone` | an IANA zone name, as `America/Sao_Paulo` | the system's own zone | The zone a day begins in and a week starts in, and the zone the store keeps its days in. A week is Monday 00:00 there, not the system's own, so a period's total holds no record from the period before |

Both modes bill the same work, and a wrong value is refused by name at startup: `usage.per` must be one of `turn` or `report`, and a `timezone` this host cannot read is one line at start and the system's own zone.

The store and the `usage:` scheme are given the same zone, so a period's total and the records behind it agree. With two zones they would count different days.

Where the records are kept is not a key: the daemon writes them into a `usage` folder beside its own configuration, and a host built from the SDK is handed its own store. Everything else about the daemon's keys is [HOST.md](HOST.md#configuration-keys).

## Commands

The `ahpd usage` commands are [server/USAGE.md](../server/USAGE.md).

## Grants

Reading a pool is `usage:get` on the `usage` subject, which like every scheme's carries the resource operations under its own name - `get`, `list`, `resolve`, `watch` in the read group - and `usage:read` is the group that holds all four ([RESOURCES.md](RESOURCES.md#grants)). There is no write half, because a record is never edited and nothing is made, and this provider implements `get`, `list` and `resolve`: a `usage:watch` is a grant a role may hold and an operation nothing here answers.

What a person may see is not only the grant. Their own `user:<id>` pool, and the `team:` and `project:` pools of the teams and projects they belong to, are readable with no grant at all, because a client showing somebody their own spending has to be able to. Any membership in a team reads `team:<team>`, so a member reads the team pool their own work is charged to. `team:*` reads every `project:<team>:<project>` and `team:<project>` reads that one, and a bare `team` reads no project pool. The grouped read at `usage://groups` needs no grant either, as the listing needs none, and it counts only the records the reader may read. Every other pool needs `usage:read`. That is the provider's own `authorize` rather than a rule in the host, which is how a scheme opens part of itself without a host change. Where the pools come from is [USERS.md](USERS.md#roles).

## See also

| | |
| --- | --- |
| [RESOURCES.md](RESOURCES.md) | What a scheme is, and the grants a resource method asks for |
| [POLICY.md](POLICY.md) | The limits a pool's total is checked against |
| [GATEWAY.md](../server/GATEWAY.md) | The calls through `/v1` that write the `gateway` records, and the prices they are charged |
| [SESSIONS.md](SESSIONS.md) | The turns the `agent` records belong to |
| [USERS.md](USERS.md#roles) | The people, teams and projects a pool is named after |
| [HOST.md](HOST.md#configuration-keys) | The daemon's keys, `usage` beside the rest |
