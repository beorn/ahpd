---
title: The question offers the approved levels
status: done
depends: [task-01-a-person-keeps-rules-of-their-own.md, task-02-the-hosts-rules-need-config-permissions.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/host/permissions.ts#L529](../../../../packages/sdk/src/host/permissions.ts#L529) - `grantOption`"
  - "[code://packages/sdk/src/host/permissions.ts#L635](../../../../packages/sdk/src/host/permissions.ts#L635) - `confirmationOptions`"
  - "[code://packages/sdk/src/host/spawn.ts#L579](../../../../packages/sdk/src/host/spawn.ts#L579) - `autoApprovePolicyRestricted`"
  - "[code://.project/plans/host/20261116-2134-always-allow-has-a-level-per-person/mockup.html](mockup.html) - the approved mockup"
---

## Objective

A question offers the options of the approved mockup, in its groups and with its labels.

## Files

- `UPDATE: packages/sdk/src/host/permissions.ts:529` - `grantOption` takes the `person` scope and the labels.
- `UPDATE: packages/sdk/src/host/permissions.ts:635` - `confirmationOptions` builds the levels for the session's owner.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the answer to "Allow All Commands in this Session" sets the session's `autoApprove`.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - the options' cases.

## Steps

1. Keep the session level as it is: "Allow `<cmd> …` in this Session" and "Allow Exact Command in this Session".
2. On a host with users, add the person level in a group of its own.
3. Label it "Always Allow `<cmd> …` for Me" and "Always Allow Exact Command for Me".
4. Offer the host level only when the session's owner holds `config:permissions`.
5. Label it "Always Allow `<cmd> …` for Everyone" and "Always Allow Exact Command for Everyone" on a host with users.
6. On a host with no users file, keep VS Code's labels for the host level, and offer no person level.
7. Put "Allow All Commands in this Session" in a last group, unless the root sets `autoApprovePolicyRestricted`.
8. On that answer, set the session's `autoApprove` to `autoApprove`, as a session config change.
9. Where the root sets `autoApprovePolicyRestricted`, refuse that answer, and keep the call asking.
10. Give file and URL grants the same levels.
11. Compare the options with the approved mockup's four states.

## Validation

- `host-permissions.test.ts`: a member's question has the session level, the person level and Allow All, in that order and those groups.
- `host-permissions.test.ts`: an admin's question also has the host level, labelled "for Everyone".
- `host-permissions.test.ts`: a host with no users file offers the options it offers today, and Allow All.
- `host-permissions.test.ts`: with `autoApprovePolicyRestricted`, the question has no Allow All, and the host refuses an answer naming it.
- The sdk suite and the computer suite pass, one at a time.

## Resume

Built on 2026-11-16, awaiting review.

- A line that the table denies gets no grant, only Allow Once, Allow All and Skip (Softov, 2026-11-16).
- The host level is offered when this process knows that the session's owner holds `config:permissions`. An owner not seen since a restart is not offered it.
- Allow All is offered on shell questions only, as its label says commands. The managed lock also takes it away.
- On a host with users, the answer that turns on Allow All needs `session:configure`, as any change of the session's config does.
- Each level is a group of its own, and Skip is in the group after the last one.
- The two cases in `host-input.test.ts` that list the options of a host with no users file now include Allow All.
- `agent-acp-rule.test.ts` reads Skip as the last option, in whichever group it falls.
