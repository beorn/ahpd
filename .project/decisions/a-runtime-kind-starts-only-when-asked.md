---
title: A runtime kind starts only when a person asks
status: accepted
date: 2026-11-26
refs:
  - "[briefs/a-list-and-its-kinds.md](../briefs/a-list-and-its-kinds.md) - the runtime class and its start and stop hooks"
  - "[code://packages/sdk/src/tunnels/channel.ts](../../packages/sdk/src/tunnels/channel.ts) - the tunnels, which the host starts by itself at listening"
---

## Context

A kind of class `runtime`, such as a process-compose service, has `start` and `stop` hooks. The host starts each stored tunnel by itself when it begins to listen. A list's rows are the kind's, and the host keeps none of them.

## Decision

The host never calls a runtime kind's `start` by itself. A row starts when a person runs `start` on it, and stops when a person runs `stop`. The host still calls `stop` on each running row when it closes.

## Consequences

- After a daemon restart, no runtime row runs until a person starts it.
- Nothing runs that nobody asked for, and a kind with many rows does not start them all at once.
- A host that starts rows by itself, as it does tunnels, can come later. Softov, 2026-11-26: "not by itself. but can change on the future".

## Options

- Start every row at listening, as the tunnels: lost, because nothing should run that nobody asked for yet.
- Start only rows not marked off: lost, because the host would read a field of the kind's record by name.
