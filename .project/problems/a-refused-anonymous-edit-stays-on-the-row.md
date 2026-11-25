---
title: A refused anonymous edit stays on the tunnel's row
status: open
date: 2026-11-19
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/tunnels/channel.ts#L556-L573](../../packages/sdk/src/tunnels/channel.ts#L556-L573) - an update stores the new settings before it calls the kind"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L473-L476](../../packages/tunnel-devtunnel/src/kind.ts#L473-L476) - `refuseOpen`, which reports an error and no setting"
---

## Symptom

On 2026-11-18 Softov edited a running tunnel on port 31546 with `anonymous` on, on a daemon with no token and no users.
The edit was refused with the message to set a connection token or a users file.
The row then said `running` and `Anonymous: Yes`.

## Cause

The host stores the edited settings, then calls the kind's `update`.
The kind refuses before it changes the tunnel's access, and reports only an error.
Nothing puts `anonymous` back, so the record holds a value the tunnel does not have.

## Impact

The row says the tunnel is open to anyone, and it is not. A later start reads `anonymous: true` and refuses to start, which is safe and puzzling.

## Workaround

Edit the tunnel again with `anonymous` off.

## Fix

- In the kind's refused update, report `settings` with the access the tunnel has, so the host saves it back.
- Or have the host store an update's settings only after the kind accepts them.
