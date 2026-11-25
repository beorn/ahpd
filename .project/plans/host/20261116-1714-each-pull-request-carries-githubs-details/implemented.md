---
title: Each pull request of a session carries what GitHub says of it - implemented
date: 2026-11-18
refs:
  - git://4a5108286 - the merge of #357
---

Each pull request a session shows carries what GitHub says of it, so a client can draw VS Code's pull request card.
The card shows the repository, the date, the title and number, the state, the description, `base ← head` and the author.
Today a recorded pull request carries only the label the agent gave it, and a state shows for one URL per folder.
On 2026-11-16 a session merged #349, and #349 never showed merged.
ahpw draws the card in its plan `sessions/20261116-1714-the-pull-request-card-shows-github`.

## What was built

- [01 - The port reads a pull request's details](task-01-the-port-reads-a-pull-requests-details.md).
- [02 - A session sends what GitHub says of each of its pull requests](task-02-a-session-sends-its-pull-requests.md).
- [03 - An open pull request is read again each minute while a client watches](task-03-an-open-pull-request-is-read-each-minute.md).
- [04 - The docs and the spec name a pull request's details](task-04-the-docs-name-the-details.md).

## Verified

- CI on #357 passed every check, Windows included, and it merged as `4a5108286`.
- Each task file says what its cases check.

## Departures from the plan

- Each task's *Resume* section says what it found while it was built, where it found anything.

## Left for later

- none
