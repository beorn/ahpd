---
title: A same-user process can pass the askpass caller check
status: open
date: 2026-11-22
severity: minor
refs:
  - "[code://packages/sdk/src/host/shellauth.ts](../../packages/sdk/src/host/shellauth.ts) - the caller check"
  - "[code://packages/sdk/src/host/askpass.ts](../../packages/sdk/src/host/askpass.ts) - the helper, which sends its pid and its socket inode"
  - "[plans/host/20261121-2250-a-shell-asks-the-person-for-a-password/plan.md](../plans/host/20261121-2250-a-shell-asks-the-person-for-a-password/plan.md) - the plan, whose Answers chose the check"
---

## Symptom

An agent's process holds the chat's token. It can connect to the host's socket itself and send a pid and a socket inode it read from `/proc`. The host then shows a shell authentication request in the name of sudo, ssh or git, and the answer goes to the agent's process.

## Cause

- The helper reports its own pid and socket inode. Node has no call that names the peer of a unix socket, so the host takes the report as given.
- sudo is setuid, so its executable link cannot be read, and the check falls back to the parent's name.
- On macOS and Windows the check is the parent's name only.

## Impact

The check stops a careless agent, not a deliberate one. The command shown with the request is the guard: a person who reads it sees what asks.

## Workaround

The setting `shellAuthentication` is off by default. With it on, read the command shown before typing a password.

## Fix

Not decided. On Linux the host can name the peer itself, in three steps:

- Read its accepted socket's inode from `/proc/self/fd`.
- Find the peer inode with `ss -xp`.
- Find the process that holds the peer in `/proc/*/fd`.
