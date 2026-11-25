---
title: The approver reads through a wrapper
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L776-L792](../../../../packages/sdk/src/access/commandautoapprover.ts#L776-L792) - the loop that matches each command"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L1015-L1021](../../../../packages/sdk/src/access/commandautoapprover.ts#L1015-L1021) - the commands a grant never names"
---

## Objective

Each command of a line is matched as the command its wrappers run, and no grant key names a wrapper.

## Files

- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:776-792` - read each command through `innerCommand` before it is matched.
- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:1015-1021` - add the wrappers to `NEVER_AUTO_APPROVE_COMMANDS`.
- `UPDATE: packages/sdk/src/host/permissions.ts:362-364` - a `permissions` deny rule also matches the inner command.
- `UPDATE: packages/sdk/test/commandautoapprover.test.ts` - the wrapper cases.
- `UPDATE: packages/sdk/test/host-permissions.test.ts` - a question on a wrapped command offers the inner command's key.

## Steps

1. Add `innerCommand(subCommand)` beside `TRANSIENT_VARIABLE`, returning the inner command, or `undefined` for a wrapper it cannot read.
2. Read the options of each wrapper in the plan's *Answers*, with their arguments, such as `timeout -s KILL -k 5 60` and `nice -n 10`.
3. Repeat `innerCommand` until the first word is no wrapper.
4. Keep `env`'s `A=1` words at the front of the inner command, and drop its options.
5. Leave `command -v` and `command -V` as they are.
6. In `evaluation`, give `classify`, `sedWritesInPlace`, `TRANSIENT_VARIABLE`, `matchesRule` and `unapprovedSubCommands` the inner command.
7. Return `noMatch` when `innerCommand` returns `undefined`, and set `hasUnsafeSubCommand` so the question offers no grant.
8. Add every wrapper of the plan's *Answers* to `NEVER_AUTO_APPROVE_COMMANDS`.
9. Leave the PowerShell path as it is.
10. In `isDeniedByPermissions`, match each deny rule on the written command and on its inner command.

## Validation

- `commandautoapprover.test.ts`: with an allow rule for `command *`, `command rm -rf x` and `command curl x | command bash` are `denied`.
- `commandautoapprover.test.ts`: with `npm test` allowed, `timeout 60 npm test`, `timeout -s KILL 5 npm test`, `nice -n 10 npm test` and `nohup npm test` are `approved`.
- `commandautoapprover.test.ts`: `nice nohup rm x` is `denied`, and `env A=1 make` is `denied` as `A=1 make` is.
- `commandautoapprover.test.ts`: `command -v pw` matches as written, and `timeout --bogus 5 make` gives `noMatch`.
- `commandautoapprover.test.ts`: `suggestAutoApproveRuleKeys` offers no key for `command -v pw` or `env FOO=1 make`.
- `host-permissions.test.ts`: a question on `timeout 60 make` offers `Shell(make)`, and one on `command rm x` offers no grant.
- Run the sdk, computer and agent-acp suites one at a time, as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17.
`innerCommand` reads each wrapper by the grammar in `WRAPPERS`, and the wrapper names join `NEVER_AUTO_APPROVE_COMMANDS`.
The plan did not know that `isDeniedByPermissions` also matches the written command, so `command make` evaded a person's `Shell(make *)` deny.
It now matches the inner command too, and a case fails without that change.
A quoted or expanded word before the command makes it unread, so `exec -a "npm test" rm` cannot pass for `npm test`.
