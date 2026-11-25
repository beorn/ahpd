---
title: An adopted session is kept with its owner - implemented
date: 2026-11-18
refs:
  - git://a00a79916 - the merge of #366
---

On a host with users, a person's turn that adopts a session makes that person its owner.
A session they make with `createSession` gets its owner the same way.
An owner check, such as a turn getting the session's approvals, then works in a session taken over from the host's own CLI.

## What was built

- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - write the owner before the adoption.
- [`code://packages/sdk/test/host-catalogue.test.ts`](../../../../packages/sdk/test/host-catalogue.test.ts) - the adoption owner case.
- [`code://docs/sdk/SESSIONS.md`](../../../../docs/sdk/SESSIONS.md) - one sentence on the owner of an adopted session.

## Verified

- On the test daemon with users, a turn on an external Claude session writes the sender as its owner in `sessions/<id>.json`.
- The sdk and computer suites pass.
- Each check passed on 2026-11-18, on the test daemon and the suites at `2946984b6`, and CI was green on #366.

## Departures from the plan

- The two cases share `signedIn`, a host with users where ana is signed in and `older` is listed external.
- The kept-owner case writes `user:bo` once the host has opened the session.
- In this fake, a record that starts with a provider and the external mark is not opened at all.

## Left for later

- Nothing.
