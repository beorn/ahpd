---
title: A hand edit of owner is taken
status: done
depends: []
layer: "bot"
refs:
  - "[code://packages/bot/src/store.ts#L222-L234](../../../../packages/bot/src/store.ts#L222-L234) - the owner refusal this task replaces"
---

## Objective

The store takes an owner change from the bot's file, logs it once through `onProblem`, and sets `updatedAt` to the time it heard the change.

## Files

- `UPDATE: packages/bot/src/store.ts:222-234` - replace the owner refusal with the log line, and set `updatedAt` on the taken bot.
- `UPDATE: packages/bot/test/bot-store.test.ts` - turn the refused owner case into a taken one, and add the restart case.

## Steps

1. In the change handler, when `before.owner` differs, call `onProblem` with `bots/<id> owner changed from <old> to <new> by an edit of its file`.
2. Set the bot's `updatedAt` to the current time before `held.set`.
3. Write the new `updatedAt` back through the collection, and skip the change that this write makes heard again.
4. Leave the `workspace` refusal as it is.
5. Change the test of the refused owner: the owner is the file's, one line is said, and `updatedAt` moved.
6. Edit the owner before the store loads, then load.
7. Check that the load gives the file's owner and says no line.

## Validation

- `bot-store.test.ts`: the changed case and the new case.
- Run the bot suite under the lock, with `TMPDIR` set.

## Resume

Done on 2026-11-23. The workspace check runs first, so a file that changes both fields is refused.
