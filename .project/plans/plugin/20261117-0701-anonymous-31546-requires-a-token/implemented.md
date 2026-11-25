---
title: An anonymous tunnel to the daemon requires an ahpd token - implemented
date: 2026-11-18
refs:
  - git://d55de8382 - the merge of #364
---

A visitor who reaches the daemon over an anonymous Dev Tunnel brings a token the daemon accepts.
While port 31546 is anonymous, the derived token is never swapped, because anyone can compute it from the URL.
A signed-in 31546 keeps the swap, so VS Code still connects there.
An anonymous 31546 is refused on a daemon with no connection token and no users, where nothing would ask for a token.

## What was built

- [01 - An anonymous hop swaps no token](task-01-an-anonymous-hop-swaps-no-token.md).
- [02 - Anonymous is refused without a token](task-02-anonymous-is-refused-without-a-token.md).
- [03 - The docs say anonymous needs a token](task-03-the-docs-say-anonymous-needs-a-token.md).

## Verified

- CI on #364 passed every check, Windows included, and it merged as `d55de8382`.
- Each task file says what its cases check.
- The anonymous checks on Softov's dev daemon passed on 2026-11-18. No token and the derived tokens got `401`, and his own token got the session list.
- Softov ran the rest by hand on 2026-11-18, and it passed. On a daemon with no token and no users, the anonymous 31546 was refused. The row said to set a connection token or a users file. VS Code connected through the tunnel with `anonymous` off.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
