---
title: A tunnel port is gated by an ahpd token - implemented
date: 2026-11-18
refs:
  - git://0677627e0 - the merge of #365
---

`requireToken` on a tunnel for another port puts ahpd's token in front of that port.
A visitor brings `?tkn=<token>` once, gets a cookie, and is redirected to the same URL without it, as VS Code's web server does.
Each request is checked, and a request with no token the daemon accepts reaches nothing on the port.

## What was built

- [01 - The plugin host checks a token](task-01-the-plugin-host-checks-a-token.md).
- [02 - A gate checks each request](task-02-a-gate-checks-each-request.md).
- [03 - The docs say what a gate does](task-03-the-docs-say-what-a-gate-does.md).

## Verified

- CI on #365 passed every check, Windows included, and it merged as `0677627e0`.
- Each task file says what its cases check.
- Softov ran the gated port checks by hand on his dev daemon on 2026-11-18, and they passed.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
