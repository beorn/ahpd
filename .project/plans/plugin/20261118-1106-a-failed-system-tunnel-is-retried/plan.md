---
title: A tunnel refused at its start is tried again
domain: plugin
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://be0d1c56b - the last commit that holds the problem a-system-tunnel-that-fails-at-start-is-not-retried.md, which this plan fixes
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L451-L540](../../../../packages/tunnel-devtunnel/src/kind.ts#L451-L540) - `start`, which reports `error` once and is not called again"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L251-L259](../../../../packages/tunnel-devtunnel/src/service.ts#L251-L259) - `statusOf` and `notFound`, which read the service's status from an error"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L146-L175](../../../../packages/tunnel-devtunnel/src/adapter.ts#L146-L175) - `OpenTunnels`, where a connector's token is held"
  - "[code://packages/tunnel-devtunnel/src/adapter.ts#L482-L500](../../../../packages/tunnel-devtunnel/src/adapter.ts#L482-L500) - `exchange`, which holds a refreshed token"
  - "[code://packages/tunnel-devtunnel/README.md#L148](../../../../packages/tunnel-devtunnel/README.md#L148) - *What the system tunnel does at startup*"
---

## Goal

A tunnel whose start the Dev Tunnels service refused with 401 starts again by itself.
It is tried again after a delay, and when its connector holds a new token.
So a restart no longer leaves the host's own tunnel down.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- On 2026-11-04 the system tunnel failed its start with a 401, and stayed in `error` until a person disabled and enabled it.
- The cause is unknown. A token not yet refreshed at the daemon's start is a guess.
- `start` already tries once more after a 404, through `remake`. A 401 has no second try.
- The adapter holds each refreshed token in `OpenTunnels`, which the kind can read but not listen to.

### Searches performed

- `rg "status: 'error'" packages/tunnel-devtunnel/src/kind.ts` - each failed start reports once.
- `rg "tunnels.hold" packages/tunnel-devtunnel/src` - the adapter holds a token at open and at each refresh.

### Gaps

- No start that failed with 401 is tried again.
- Nothing tells the kind that a connector holds a new token.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A start that failed with 401 is tried again after a delay, and again when the connector's token is refreshed | Softov, 2026-11-18: "Retry after a delay, and on refresh" | 01 |
| Only a 401 is tried again | (defaulted: the refusal the problem saw, and the one a new token may change) | 01 |
| The delays are 30 s, then doubling up to 10 min, with no limit on tries | (defaulted: a host's own tunnel is worth trying until it runs) | 01 |
| A record stopped, disabled or removed is not tried again | (defaulted: a person's stop wins over a retry) | 01 |
| The row says when the next try is, beside the error | (defaulted: a person sees that it is not given up) | 01 |
| Every record of the kind is tried again, not only the system tunnel | (defaulted: a person tunnel meets the same 401) | 01 |

## Proposed architecture

- **Data flow** - a 401 in `start` sets a timer for that record. The record also waits for its connector's next held token.
- **Event flow** - `OpenTunnels` tells its listeners each time it holds a token, and the kind starts the records of that connector that wait.
- **Layer responsibilities** - tunnel-devtunnel: `kind.ts`, `adapter.ts`, `README.md` · docs: the notes.
- **Source-of-truth files** - [`code://packages/tunnel-devtunnel/src/kind.ts`](../../../../packages/tunnel-devtunnel/src/kind.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a refused start is tried again](task-01-a-refused-start-is-tried-again.md) | done | - |

## Risks and tradeoffs

- A 401 that no new token cures is tried every 10 min - one call to the service each time, and the row says why.

## Resume state

- **Done so far:** task 01. The waits are a kind option, `retryMs`, so the cases run in milliseconds.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** a retry must not run after the plugin stops or the record is stopped; clear each timer there.

## Final verification checklist

- [ ] A case with a service that answers 401 once sees the record running after the first retry.
- [ ] A case sees a waiting record start when its connector holds a new token.
- [ ] The tunnel-devtunnel and server suites pass, and `check` and `check-windows` are green.
