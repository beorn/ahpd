---
title: An open pull request is read again each minute while a client watches
status: done
depends: [task-02-a-session-sends-its-pull-requests.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/facts.ts#L454-L462](../../../../packages/sdk/src/host/facts.ts#L454-L462) - `watchedIn`, whether a client watches the directory"
  - "[code://packages/sdk/src/host/facts.ts#L545-L571](../../../../packages/sdk/src/host/facts.ts#L545-L571) - `stopWatchingDir` and `startWatchingDir`, which the poll starts and stops with"
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/sessions/contrib/github/browser/github.contribution.ts#L254-L283 - VS Code's window polls each one unless it is merged
---

## Objective

While a client watches a directory, every 60 seconds ahpd reads again each pull request it holds there that is not merged.
A merge made on GitHub, outside any turn, shows within a minute.

## Files

- `UPDATE: packages/sdk/src/host/facts.ts:545-571` - a poll timer per directory, started and stopped with the directory's watch.
- `UPDATE: packages/sdk/test/host-github.test.ts` - the poll's cases, with fake timers.

## Steps

1. Add a constant `PULL_REQUEST_POLL_MS = 60_000`, with a comment that links VS Code's interval.
2. In `startWatchingDir`, start an interval for the directory, and `unref()` it.
3. On each tick, return at once when `watchedIn(dir)` is false.
4. Otherwise read by `byUrl` each held entry of the directory that is not merged.
5. Call `metaChanged(dir)` once when an entry changed.
6. Run no tick while the one before it is still reading.
7. In `stopWatchingDir`, clear the directory's interval.

## Validation

- `packages/sdk/test/host-github.test.ts`: "reads an open pull request again after a minute while a client watches, and says it merged".
- `packages/sdk/test/host-github.test.ts`: "reads nothing on a tick when no client watches".
- `packages/sdk/test/host-github.test.ts`: "does not poll a merged pull request".
- `packages/sdk/test/host-github.test.ts`: "stops the poll when the directory's watch stops".
- The sdk suite passes.

## Resume

Built on 2026-11-16, awaiting review.

- The poll is a timer of its own per directory, started in `startWatchingDir` before the changes watch.
- A host with no changes port still polls, and `stopWatchingDir` clears the timer.
- An unsubscribe stops the watch, so one case covers "reads nothing when no client watches" and "stops the poll with the watch".

