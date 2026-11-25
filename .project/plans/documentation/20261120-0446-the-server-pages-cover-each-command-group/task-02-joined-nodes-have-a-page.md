---
title: Joined nodes have a page
status: done
depends: []
layer: "docs, server"
refs:
  - "[code://packages/server/src/commands/nodes.ts](../../../../packages/server/src/commands/nodes.ts) - `ahpd node`"
  - "[code://packages/server/src/commands/join.ts](../../../../packages/server/src/commands/join.ts) - `ahpd join`"
  - "[code://docs/plugins/COMPUTERS.md#L428-L490](../../../../docs/plugins/COMPUTERS.md#L428-L490) - *Joined nodes*"
---

## Objective

`docs/server/NODES.md` says what a hub and a joined node are, and what `ahpd join` and each `ahpd node` command does.
`node rm`'s help says a removed node is cut off at once.

## Files

- `CREATE: docs/server/NODES.md` - a hub and its nodes, and `join`, `node list`, `node add` and `node rm`.
- `UPDATE: docs/plugins/COMPUTERS.md:428` - *Joined nodes* links `NODES.md` for the commands.
- `UPDATE: packages/server/src/commands/nodes.ts:166` - `node rm`'s description says the node is cut off at once.
- `UPDATE: docs/.vitepress/config.mts:35` - `NODES.md` in the Server group.
- `UPDATE: docs/README.md` - `NODES.md` in the `server` table.

## Steps

1. Write what a hub and a node are: a host that runs sessions for another host.
2. Write the command table: `join <url>`, `node list`, `node add <id>`, `node rm <id>`.
3. Say that `node add` shows the token once, and that adding a node again replaces its token.
4. Say that `node rm` and a new token cut the node off at once, with its sessions.
5. Link *Joined nodes* in `plugins/COMPUTERS.md` for what runs on a node, and link `NODES.md` from there.
6. Change `node rm`'s description to say the node is cut off at once.
7. Add the page to the sidebar and the index.

## Validation

- Each command's line matches its `--help` and its code.
- `ahpd node rm --help` says the node is cut off at once.
- The server suite passes, and `pnpm docs:build` passes.

## Resume

Written on 2026-11-20. Four things moved from *Joined nodes* to `NODES.md`, so each is in one file.
They are the command table, the nodes file, the grants and the paragraph on the running daemon.
*Joined nodes* keeps what runs on a node, its trust, its version and a restart.
`node rm`'s help says a running daemon drops the node at once.
With no daemon answering, it says the token is refused from the node's next connection on.
The server suite passed, 1982 cases.

