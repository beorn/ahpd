---
title: A Dev Tunnel the service deleted is made again
domain: plugin
status: built
priority: high
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - "[code://packages/tunnel-devtunnel/src/service.ts#L471-L487](../../../../packages/tunnel-devtunnel/src/service.ts#L471-L487) - `get` makes a tunnel again on a 403, and waits for a `null` the SDK never answers"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L280-L302](../../../../packages/tunnel-devtunnel/src/service.ts#L280-L302) - `entryOf` holds a connector's tunnel for as long as the daemon runs"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L285-L300](../../../../packages/tunnel-devtunnel/src/kind.ts#L285-L300) - the page's read, which only warns when the tunnel is gone"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L544-L560](../../../../packages/tunnel-devtunnel/src/kind.ts#L544-L560) - `restart`, which reports the service's error"
  - npm://@microsoft/dev-tunnels-management@1.3.61 - `getTunnel` throws on a 404, with `response.status`; only a port delete allows one
  - https://github.com/microsoft/vscode/blob/53fa24195c2/cli/src/tunnels/dev_tunnels.rs#L808-L835 - VS Code's CLI deletes an unused tunnel labelled `vscode-server-launcher` at the account's limit
---

## Goal

The plugin makes a Dev Tunnel again when the service no longer has it, at a start and while the daemon runs.
VS Code's CLI makes its own tunnel again the same way.
On 2026-11-17 the service deleted the dev daemon's tunnel.
Every start, stop and restart then failed with `Tunnel service error: Not Found`, a restart of the daemon included.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "allowNotFound" node_modules/@microsoft/dev-tunnels-management` - `getTunnel` passes no `allowNotFound`, so a 404 throws.
- `rg "deleteTunnel" packages/tunnel-devtunnel/src` - ahpd deletes a tunnel only with `keep: false`.

### Runtime path

```
start -> service.add -> entryOf -> get(kept): 404 -> find(name) -> make -> kept written
running op or page read -> 404 -> kind: service.forget(connector) -> every record of that connector started again
```

### Gaps

- A 404 at `get` stops the start where it should make the tunnel again.
- A tunnel deleted while the daemon runs stays held, and every operation on it fails.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A tunnel the service no longer has is made again at a start and while running | Softov, 2026-11-17: "Make it again, at start and while running" | 01, 02 |
| Nothing is changed by hand on the dev daemon; the tunnel comes back with this fix | Softov, 2026-11-17: "Wait for the code fix" | - |
| A 404 is the service saying it has no such tunnel, read from `response.status` | npm://@microsoft/dev-tunnels-management@1.3.61 | 01 |
| A remake starts every running record of that connector again, since they share the tunnel | (defaulted: one Dev Tunnel carries every port of a connector) | 02 |
| A remake is tried once for each failure, and a second failure is reported as it is | (defaulted: no loop against a service that keeps refusing) | 02 |
| A stop of a record whose tunnel is gone reports it stopped | (defaulted: the port is already off) | 02 |

## Proposed architecture

- **Data flow** - `notFound(error)` reads a 404. `get` answers nothing on it, and `service.forget` lets a held tunnel go.
- **Event flow** - a 404 on an operation or a page read calls `remake(connector)`.
  It forgets the tunnel, and starts its records again with the reports they started with.
- **Layer responsibilities** - tunnel-devtunnel: `service.ts` and `kind.ts` · docs: the plugin README.
- **Source-of-truth files** - [`code://packages/tunnel-devtunnel/src/service.ts`](../../../../packages/tunnel-devtunnel/src/service.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a missing tunnel is made again at start](task-01-a-missing-tunnel-is-made-again-at-start.md) | done | - |
| [02 - a running tunnel deleted is made again](task-02-a-running-tunnel-deleted-is-made-again.md) | done | 01 |
| [03 - the docs say a deleted tunnel comes back](task-03-the-docs-say-a-deleted-tunnel-comes-back.md) | done | 02 |

## Risks and tradeoffs

- A tunnel made again has a new id, address and derived token - the README says so, and a client finds it by name.
- VS Code's CLI may delete it again at the account's limit - the README names the cause and the label.

## Resume state

- **Checks, 2026-11-18:** the suites passed at `2946984b6`. The checks that need the Dev Tunnel account passed on 2026-11-18, as [implemented.md](implemented.md) says. git://fe8c59241 is the last commit that holds their file.
- **Done so far:** tasks 01 to 03 are `implemented` on 2026-11-17, on the branch `plugin/20261117-2030-a-deleted-tunnel-is-made-again`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** the kept id file is written only when the id changes, so a remake rewrites it through `entryOf`.

## Final verification checklist

- [ ] The dev daemon, restarted on this fix, makes its tunnel again, and the record reports `running` with a new URL.
- [ ] A tunnel deleted with `devtunnel delete` while the daemon runs comes back within one page read.
- [x] The tunnel-devtunnel and server suites pass.
