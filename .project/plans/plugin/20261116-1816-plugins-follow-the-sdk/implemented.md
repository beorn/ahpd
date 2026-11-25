---
title: A plugin follows the sdk the daemon ships - implemented
date: 2026-11-18
refs:
  - git://2fa19f87f - the merge of #355
---

An upgrade keeps every agent working, also an upgrade to a release candidate.
A plugin is checked against the sdk the daemon ships, when it loads and when its version is picked.
A daemon whose sdk is a prerelease takes a plugin's prerelease when the plugin's range admits that sdk.
Each release sets the first-party plugins' range from the sdk it ships to the next minor, and CI and the release refuse any other range.
The 0.15 release notes tell a tester what to run after an upgrade.

## What was built

- [01 - The sdk the daemon ships is the gate](task-01-the-shipped-sdk-is-the-gate.md).
- [02 - A prerelease sdk takes the prereleases its plugins admit](task-02-a-prerelease-sdk-takes-prereleases.md).
- [03 - A release sets each plugin's sdk range](task-03-a-release-sets-the-sdk-range.md).
- [04 - The notes say how to upgrade](task-04-the-notes-say-how-to-upgrade.md).

## Verified

- CI on #355 passed every check, Windows included, and it merged as `2fa19f87f`.
- Each task file says what its cases check.

## Departures from the plan

- The server, sdk and computer suites pass.

## Left for later

- none
