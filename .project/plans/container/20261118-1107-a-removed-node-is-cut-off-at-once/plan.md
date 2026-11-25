---
title: A removed node is cut off at once
domain: container
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://e4aa35c20 - the last commit that holds the problems a-removed-node-keeps-serving-its-running-sessions.md and node-rm-at-the-terminal-does-not-drop-a-joined-node.md, which this plan fixes
  - "[code://packages/sdk/src/nodes.ts#L485-L498](../../../../packages/sdk/src/nodes.ts#L485-L498) - `session`, which takes the socket a node dials back for one session"
  - "[code://packages/sdk/src/nodes.ts#L564-L589](../../../../packages/sdk/src/nodes.ts#L564-L589) - `drop`, which closes only the control socket, and `add` and `remove`"
  - "[code://packages/server/src/commands/nodes.ts#L52-L125](../../../../packages/server/src/commands/nodes.ts#L52-L125) - `node add` and `node rm`, which at the terminal edit the file alone"
  - "[code://packages/server/src/commands/paths.ts#L150-L178](../../../../packages/server/src/commands/paths.ts#L150-L178) - `forward`, how `paths` sends its change to the running daemon and edits the file only when none answers"
  - "[code://docs/plugins/COMPUTERS.md#L428](../../../../docs/plugins/COMPUTERS.md#L428) - *Joined nodes*, which says a removed node is dropped"
---

## Goal

A node taken off the hub stops at once: its control socket and every session socket it dialled close.
`ahpd node rm` at the hub's terminal does this too, through the running daemon.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- `drop` closes the control socket and fails the sessions still opening. A session socket the node already dialled stays open, so its session keeps running.
- At the terminal, `node rm` writes the file and nothing more, so the daemon's live registry never hears of it.
- `node add` of a node that is there replaces its token, and at the terminal leaves the old connection up in the same way.
- `paths add` and `paths remove` send their change to the running daemon's API when one answers, and write the file only when none does.

### Searches performed

- `rg "drop\(" packages/sdk/src/nodes.ts` - `add` and `remove` both drop.
- `rg "tokenIn|forward" packages/server/src/commands` - `paths.ts` and `plugin.ts` reach the running daemon this way.

### Gaps

- The registry keeps no list of a node's session sockets.
- The terminal commands do not reach the running daemon.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `node rm` at the terminal goes to the running daemon when one is up | Softov, 2026-11-18: "Send it to the running daemon" | 02 |
| It follows `paths`: the API when the daemon answers, the file when none does | [code://packages/server/src/commands/paths.ts#L150-L178](../../../../packages/server/src/commands/paths.ts#L150-L178) | 02 |
| `node add` of a node that is there goes the same way | (defaulted: it replaces a token, and the old connection must go as with a removal) | 02 |
| A command forwards only with no `--users` and no `--config-file`, since a named file may be one the daemon does not read | (defaulted: the rule `paths` follows) | 02 |
| A running daemon with no HTTP API gets the file written, and the line says the node stays until a restart | (defaulted: the command cannot reach that daemon) | 02 |
| `drop` closes every session socket of the node | (defaulted: the problem's one fix) | 01 |
| A node whose control socket closes by itself keeps its session sockets | (defaulted: a node that dials again resumes them, as today) | 01 |

## Proposed architecture

- **Data flow** - the registry keeps each node's session peers, and `drop` closes them with the control peer.
- **Layer responsibilities** - sdk: `nodes.ts` · server: `commands/nodes.ts` · docs: `COMPUTERS.md`, the notes.
- **Source-of-truth files** - [`code://packages/sdk/src/nodes.ts`](../../../../packages/sdk/src/nodes.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a dropped node closes its sessions](task-01-a-dropped-node-closes-its-sessions.md) | done | - |
| [02 - the terminal commands reach the daemon](task-02-the-terminal-commands-reach-the-daemon.md) | done | 01 |

## Risks and tradeoffs

- A session running on a removed node ends mid-turn - removing a node is the operator saying it must stop.

## Resume state

- **Done so far:** tasks 01 and 02. The commands forward only when no `--users` and no `--config-file` is given, as `paths` does.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** a node's own reconnect is not a removal; only `drop` closes the session sockets.

## Final verification checklist

- [ ] On a test hub with a joined node and a running session there, `ahpd node rm` at the terminal ends the session and the node's connection.
- [ ] With the daemon stopped, `ahpd node rm` writes the file as today.
- [ ] The sdk, computer and server suites pass, one at a time, and `check` and `check-windows` are green.
