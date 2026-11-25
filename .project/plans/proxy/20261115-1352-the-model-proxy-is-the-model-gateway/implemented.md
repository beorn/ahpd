---
title: The model proxy is the model gateway - implemented
date: 2026-11-18
refs:
  - git://c28d0a4f6 - the merge of #345
---

ahpd calls the model proxy the model gateway, in every name a person reads, types or stores.
The config key, the command, the route, the grants, the policy value and the usage source all say gateway.
No old name is read: a host that updates from 0.14 edits its files by hand, as the upgrade page says.
ahpw follows in its own plan, `hosts/20261115-1356-the-model-gateway-section` in the ahpw repository.

## What was built

- [01 - The daemon reads modelGateway](task-01-the-daemon-reads-model-gateway.md).
- [02 - Grants, policy and usage say gateway](task-02-grants-policy-and-usage-say-gateway.md).
- [03 - The docs say model gateway](task-03-the-docs-say-model-gateway.md).

## Verified

- CI on #345 passed every check, Windows included, and it merged as `c28d0a4f6`.
- Each task file says what its cases check.

## Departures from the plan

- ahpw follows in its own plan, `hosts/20261115-1356`.

## Left for later

- none
