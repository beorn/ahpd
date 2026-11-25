---
title: A push device hears only its owner's openings - implemented
date: 2026-11-18
refs:
  - git://c57600fac - the merge of #378
---

On a host with users, a push device hears a session its client opened only when the person who opened it is the device's owner.
A client id is what a connection says of itself, so a device registered with another person's client id hears nothing of theirs.

## What was built

- [01 - An opening says who opened it, and a device hears only its owner's](task-01-an-opening-says-who-opened-it.md).

## Verified

- CI on #378 passed every check, Windows included, and it merged as `c57600fac` on 2026-11-18.
- Each task file says what its cases check.

## Departures from the plan

- The host raises `session_opened` once per client, session and owner, so a second person under the same client id is heard.

## Left for later

- none
