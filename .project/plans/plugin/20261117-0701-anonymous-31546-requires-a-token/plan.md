---
title: An anonymous tunnel to the daemon requires an ahpd token
domain: plugin
status: built
priority: high
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - git://df8da5a73 - the last commit that holds `briefs/an-anonymous-tunnel-requires-an-ahpd-token.md`, with the facts checked at `19ed69394`
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L344-L379](../../../../packages/tunnel-devtunnel/src/kind.ts#L344-L379) - `hopFor` and the admit decision, which swaps the derived token whether or not the port is anonymous"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L386-L420](../../../../packages/tunnel-devtunnel/src/kind.ts#L386-L420) - `start`, which reads `anonymous` and refuses no combination"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L503-L518](../../../../packages/tunnel-devtunnel/src/kind.ts#L503-L518) - `access`, the `anonymous` operation"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L655-L664](../../../../packages/tunnel-devtunnel/src/kind.ts#L655-L664) - `update` applies a saved `anonymous` to a running port"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts#L207-L213](../../../../packages/tunnel-devtunnel/src/plugin.ts#L207-L213) - `guarded`, kept from `listening`"
  - "[code://packages/server/src/commands/options.ts#L1661-L1669](../../../../packages/server/src/commands/options.ts#L1661-L1669) - a daemon on loopback runs with no token unless one is given"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L246-L320](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts#L246-L320) - the cases of the derived token and `requireToken`, the pattern for the new ones"
  - "[code://.project/briefs/a-cloudflare-tunnel-publishes-the-daemon.md](../../../briefs/a-cloudflare-tunnel-publishes-the-daemon.md) - the sibling kind refuses a public tunnel on a daemon that is not `guarded`"
---

## Goal

A visitor who reaches the daemon over an anonymous Dev Tunnel brings a token the daemon accepts.
While port 31546 is anonymous, the derived token is never swapped, because anyone can compute it from the URL.
A signed-in 31546 keeps the swap, so VS Code still connects there.
An anonymous 31546 is refused on a daemon with no connection token and no users, where nothing would ask for a token.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The brief at `git://df8da5a73` holds the facts and the reference.

### Searches performed

- `rg "anonymous" packages/tunnel-devtunnel/src/kind.ts` - the hop never reads it; `start`, `access` and `update` change it.
- `rg "guarded" packages/tunnel-devtunnel/src` - read only for a line the system tunnel says.

### Runtime path

```
start / access / update with anonymous -> refused when 31546, not guarded and no users
visitor on 31546 -> hop -> anonymous: keep the token -> daemon checks it
visitor on 31546 -> hop -> signed in: swap the derived token as today
```

### Gaps

- The hop swaps the derived token on an anonymous port.
- Nothing refuses an anonymous 31546 on a daemon that asks for no token.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The derived token is not swapped while 31546 is anonymous | Softov, 2026-11-17: "Only while anonymous" | 01 |
| A signed-in 31546 keeps the swap and `requireToken` as today | Softov, 2026-11-17: "Only while anonymous" | 01 |
| An anonymous 31546 is refused on a daemon with no token and no users | Softov, 2026-11-17: "Refuse anonymous" | 02 |
| The refusal covers a start, the `anonymous` operation and a saved record | (defaulted: each is a way `anonymous` turns on) | 02 |
| Turning anonymous on sets the hop before the port; turning it off sets the port first | (defaulted: no moment where an anonymous port swaps the token) | 01 |
| The refusal says to set a connection token or a users file | (defaulted: the two ways a daemon asks for a token) | 02 |

## Proposed architecture

- **Data flow** - the hop holds `anonymous` beside `requireToken`, and the admit decision keeps every token while either is on.
- **State flow** - `start`, `access` and `update` write `hop.anonymous` as they change the port's access.
- **Layer responsibilities** - tunnel-devtunnel: `kind.ts` only · docs: the plugin README and `docs/updates/v0_15.md`.
- **Source-of-truth files** - [`code://packages/tunnel-devtunnel/src/kind.ts`](../../../../packages/tunnel-devtunnel/src/kind.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an anonymous hop swaps no token](task-01-an-anonymous-hop-swaps-no-token.md) | done | - |
| [02 - anonymous is refused without a token](task-02-anonymous-is-refused-without-a-token.md) | done | 01 |
| [03 - the docs say anonymous needs a token](task-03-the-docs-say-anonymous-needs-a-token.md) | done | 02 |

## Risks and tradeoffs

- VS Code cannot connect to an anonymous 31546 - the docs say so, and a person turns anonymous off for VS Code.
- A person who relied on an anonymous tunnel with no token loses access at the update - the 0.15 notes say what to set.

## Resume state

- **Checks, 2026-11-18:** the suites passed at `2946984b6`. The checks that need the Dev Tunnel account passed on 2026-11-18, as [implemented.md](implemented.md) says. git://fe8c59241 is the last commit that holds their file. On 2026-11-18, Softov's dev daemon refused no token and both derived tokens over the anonymous 31546, and admitted his own token.
- **Done so far:** tasks 01 to 03 are `implemented` on 2026-11-17, on the branch `plugin/20261117-0701-anonymous-31546-requires-a-token`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** `guarded` is known only after `listening`, and the system tunnel starts after it. A record started before `listening` has no hop, since `hopFor` needs the daemon's port.

## Final verification checklist

- [x] On the test daemon with a token, an anonymous 31546 refuses the derived token and admits `?tkn=<token>`.
- [ ] A signed-in 31546 still admits VS Code by the derived token.
- [ ] On a daemon with no token and no users, the `anonymous` operation is refused, and the row says why.
- [x] The tunnel-devtunnel and server suites pass.
