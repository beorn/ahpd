---
title: The node commands at the terminal reach the running daemon
status: done
depends: [task-01-a-dropped-node-closes-its-sessions.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/nodes.ts#L52-L125](../../../../packages/server/src/commands/nodes.ts#L52-L125) - `node add` and `node rm`"
  - "[code://packages/server/src/commands/paths.ts#L150-L178](../../../../packages/server/src/commands/paths.ts#L150-L178) - `forward`, the pattern"
---

## Objective

At the hub's terminal, `ahpd node rm` and `ahpd node add` go to the running daemon when it answers, and write the file only when no daemon answers.

## Files

- `UPDATE: packages/server/src/commands/nodes.ts:52-125` - a `forward` as `paths` has one, used by `add` and `rm` with no `served` facts.
- `CREATE: packages/server/test/server-node-forward.test.ts` - the cases of the two commands with a daemon up and with none, on the shape of `server-paths.test.ts`.
- `UPDATE: packages/server/src/commands/paths.ts` - `tokenIn` and `API_PREFIX` are exported for the node commands.
- `UPDATE: packages/server/src/commands/plugin.ts` - its own copy of `tokenIn` goes, and it imports the one in `paths.ts`.
- `UPDATE: docs/plugins/COMPUTERS.md:428` - `node rm` and `node add` reach a running daemon.
- `UPDATE: docs/updates/v0_15.md` - a line in the unreleased notes.

## Steps

1. Add a `forward` to `nodes.ts` that copies the one in `paths.ts`: the daemon's API, the token from `connectUrl`.
2. In `rm`, with no `served` facts, call `forward` first, and write the file only when it answers nothing.
3. Do the same in `add`, and print the token the daemon answers.
4. For a daemon with no HTTP API, write the file and say that the node stays until a restart.
5. Add a case: `node rm` with a daemon up removes the node through it.
6. Add a case: `node rm` with no daemon writes the file as today.
7. Add a case: `node add` of a node that is there, with a daemon up, replaces its token through it.
8. Say in *Joined nodes* in `COMPUTERS.md` that the commands reach a running daemon.
9. Add a line to the unreleased notes.

## Validation

- The case of step 5 passes, and fails without step 2.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

