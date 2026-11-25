---
title: Bots and push devices change by commands only - implemented
date: 2026-11-24
refs:
  - "[code://packages/bot/src/plugin.ts](../../../../packages/bot/src/plugin.ts) - the bot scheme"
  - "[code://packages/push/src/plugin.ts](../../../../packages/push/src/plugin.ts) - the push scheme"
---

`resourceWrite` and `resourceDelete` on `bot://` and `push://` are refused with `NotFound`, and the message names the command. Reads, lists and watches stay.

For `v0_16.md`: a client that changes a bot or a device by resource calls alone can no longer do it.

## Verified

- The bot and push suites, and the webhook cases: 338 cases. One case per scheme covers the refusals.
- The whole suite once, before the last edits: 10560 cases passed. The one that failed was the new case, which is fixed.

## Departures from the plan

- The schemes keep `write` and `delete` members, which refuse. ahpw reads `put` in the advertised operations before it offers notifications. The host reads the grants from the same members.
- The refusal has the code of the host, and names the command in its message.
- `docs/plugins/push.md` names no resource write, so it did not change.
- The check in ahpw by hand is not done.
