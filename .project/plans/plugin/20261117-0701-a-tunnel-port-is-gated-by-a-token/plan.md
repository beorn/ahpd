---
title: A tunnel port is gated by an ahpd token
domain: plugin
status: built
priority: medium
created: 2026-11-17
revalidated: 2026-11-17
requires:
  - plans/plugin/20261117-0701-anonymous-31546-requires-a-token/plan.md
refs:
  - git://df8da5a73 - the last commit that holds `briefs/a-tunnel-port-is-gated-by-an-ahpd-token.md`, with the facts checked at `19ed69394`
  - "[code://packages/tunnel-devtunnel/src/service.ts#L455-L466](../../../../packages/tunnel-devtunnel/src/service.ts#L455-L466) - a port with no handler is piped to the same port on this machine"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L347](../../../../packages/tunnel-devtunnel/src/service.ts#L347) - `carry`, which sets or clears a port's handler"
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L56-L100](../../../../packages/tunnel-devtunnel/src/forward.ts#L56-L100) - the request head and its `tkn` helpers, which the gate reuses"
  - "[code://packages/tunnel-devtunnel/src/forward.ts#L191-L220](../../../../packages/tunnel-devtunnel/src/forward.ts#L191-L220) - `carry` reads the first request only, then joins the streams"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L350](../../../../packages/tunnel-devtunnel/src/kind.ts#L350) - only 31546 gets a handler"
  - "[code://packages/sdk/src/types/plugin.ts#L1153-L1176](../../../../packages/sdk/src/types/plugin.ts#L1153-L1176) - `personKey`, the sibling member a token check sits beside"
  - "[code://packages/sdk/src/listen.ts#L159-L195](../../../../packages/sdk/src/listen.ts#L159-L195) - `doorOf`: the daemon's token, then `identify`"
  - "[code://packages/server/src/commands/run.ts#L780-L796](../../../../packages/server/src/commands/run.ts#L780-L796) - the door's options, built once for the daemon"
  - "[code://packages/server/src/plugins.ts#L954-L960](../../../../packages/server/src/plugins.ts#L954-L960) - how `personKey` reaches a plugin, the path a token check takes"
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/server/node/webClientServer.ts#L312-L334 - VS Code sets a cookie from `?tkn=` and redirects to the URL without it
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/server/node/serverConnectionToken.ts#L120-L132 - VS Code checks `?tkn=`, then the cookie
---

## Goal

`requireToken` on a tunnel for another port puts ahpd's token in front of that port.
A visitor brings `?tkn=<token>` once, gets a cookie, and is redirected to the same URL without it, as VS Code's web server does.
Each request is checked, and a request with no token the daemon accepts reaches nothing on the port.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The brief at `git://df8da5a73` holds the facts and the reference.

### Searches performed

- `rg "personKey|hasUsers" packages/sdk/src/types/plugin.ts` - a plugin can mint a key, and cannot check a token.
- `rg "pipeTo|carry\(" packages/tunnel-devtunnel/src` - another port is piped raw; `requireToken` does nothing there.

### Runtime path

```
visitor -> relay -> gate: tkn or ahpd-tkn cookie -> plugin.acceptsToken -> daemon's token or a person's
  ?tkn= accepted -> 302 without tkn, Set-Cookie ahpd-tkn
  cookie accepted -> request without the cookie, Connection: close -> 127.0.0.1:<port>
  none accepted -> 401
```

### Gaps

- A plugin cannot ask whether the daemon accepts a token.
- Another port has no handler, so nothing can stand in front of it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `requireToken` on another port gates the port by an ahpd token | Softov, 2026-11-17: "Gate the port by a token" | 02 |
| A visitor carries `?tkn=` once, then a cookie | Softov, 2026-11-17: "?tkn= once, then a cookie" | 02 |
| Any token the daemon accepts passes | Softov, 2026-11-17: "Any accepted token" | 01 |
| A token passes when it is the daemon's own, or when it names a person | (defaulted: the door admits any token on a daemon with none of its own, so admission alone checks nothing) | 01 |
| The plugin host checks a token, not the plugin | (defaulted: only the daemon knows its tokens) | 01 |
| The cookie holds the token, and each request checks it again | (defaulted: as VS Code; no secret to keep or revoke) | 02 |
| The cookie is `HttpOnly`, `Secure` and `SameSite=Lax`, for one week | (defaulted: VS Code's lifetime; the port's app has no reason to read it) | 02 |
| The port's app never sees `tkn` or the cookie | (defaulted: an ahpd credential stays out of another app) | 02 |
| A forwarded request gets `Connection: close`, except an upgrade | (defaulted: `carry` joins the streams after one request, so one request per connection is what makes each one checked) | 02 |
| A request with no accepted token gets `401`, and a stream that is not HTTP is closed | (defaulted: the gate reads HTTP only) | 02 |
| A saved change of `requireToken` on a running port sets or clears the gate | (defaulted: as a change of `person` applies on the running port) | 02 |

## Proposed architecture

- **Data flow** - the gate in `forward.ts` reads the head, asks `acceptsToken`, and answers `302`, carries the request, or answers `401`.
- **State flow** - none in the gate. The cookie holds the token, and the daemon answers each check.
- **Layer responsibilities** - sdk: `PluginHost.acceptsToken`, and the check beside `doorOf` · server: the wiring · tunnel-devtunnel: the gate on another port.
- **Source-of-truth files** - [`code://packages/tunnel-devtunnel/src/forward.ts`](../../../../packages/tunnel-devtunnel/src/forward.ts), [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the plugin host checks a token](task-01-the-plugin-host-checks-a-token.md) | done | - |
| [02 - a gate checks each request](task-02-a-gate-checks-each-request.md) | done | 01 |
| [03 - the docs say what a gate does](task-03-the-docs-say-what-a-gate-does.md) | done | 02 |

## Risks and tradeoffs

- `Connection: close` costs a new connection per request - a gated app is slower than an open one, and is checked on every request.
- A port that speaks no HTTP cannot be gated - the docs say so, and its stream is closed.
- A plugin built against the sdk sees one more `PluginHost` member - no first-party plugin implements `PluginHost`.

## Resume state

- **Checks, 2026-11-18:** the suites passed at `2946984b6`. The checks that need the Dev Tunnel account passed on 2026-11-18, as [implemented.md](implemented.md) says. git://fe8c59241 is the last commit that holds their file.
- **Done so far:** tasks 01 to 03 are `implemented` on 2026-11-17, on the branch `plugin/20261117-0701-a-tunnel-port-is-gated-by-a-token`, stacked on plan 1's branch.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** an sdk host change runs the computer suite too, as HANDOFF *Tests* says.

## Final verification checklist

- [ ] On the test daemon, a gated port answers `401` with no token, and `302` with a cookie for `?tkn=<token>`.
- [ ] A browser on the gated URL loads the app after the redirect, and the app sees no `tkn` and no `ahpd-tkn`.
- [ ] A revoked person's token stops passing at the next request.
- [x] The sdk, computer, server and tunnel-devtunnel suites pass.
