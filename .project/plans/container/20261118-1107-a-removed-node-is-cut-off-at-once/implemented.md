---
title: A removed node is cut off at once - implemented
date: 2026-11-18
refs:
  - git://ffe4e314f - the merge of #382
---

A node taken off the hub stops at once: its control socket and every session socket it dialled close.
`ahpd node rm` at the hub's terminal does this too, through the running daemon.

## What was built

- [01 - A dropped node closes its sessions](task-01-a-dropped-node-closes-its-sessions.md).
- [02 - The node commands at the terminal reach the running daemon](task-02-the-terminal-commands-reach-the-daemon.md).

## Verified

- CI on #382 failed `processes (1/2)` once, on the servercheck timeout in [problems/computer-cases-time-out-on-a-busy-machine.md](../../../problems/computer-cases-time-out-on-a-busy-machine.md). The job run again passed, and the PR merged as `ffe4e314f` on 2026-11-18.
- Each task file says what its cases check.
- The check by hand on the test daemon passed on 2026-11-18: `ahpd node rm` at the terminal reached the daemon, and the node's session host stopped. The node ran on the same workstation.

## Departures from the plan

- The commands forward only when no `--users` and no `--config-file` is given, as `paths` does.

## Left for later

- none
