---
title: Configure adds a person and prints the next commands
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/configure.ts#L420-L452](../../../../packages/server/src/commands/configure.ts#L420-L452) - the last question, the one write of the file, and the install"
  - "[code://packages/server/src/commands/user.ts#L150-L196](../../../../packages/server/src/commands/user.ts#L150-L196) - `user.add`, the add this task does the same way"
  - "[code://packages/sdk/src/access/users.ts#L1303](../../../../packages/sdk/src/access/users.ts#L1303) - the defined roles, also put together at L1559"
  - "[code://packages/server/test/server-configure.test.ts#L214](../../../../packages/server/test/server-configure.test.ts#L214) - the case that presses Enter at every question"
---

## Objective

After the marketplaces question, `configure` asks whether to add a person now, and a yes adds one to the users file.
The run ends with the commands to run next.

## Files

- `UPDATE: packages/sdk/src/access/users.ts:1303` - `roleNames()` on `fileUsers`, and one helper for the two places that put the defined roles together.
- `UPDATE: packages/sdk/src/types/users.ts` - `roleNames?()` on `Users`, the roles a host defines, sorted.
- `UPDATE: packages/server/src/commands/configure.ts` - the person question, the `users` key, `added` on `Configured`, and the closing lines.
- `UPDATE: packages/server/test/server-configure.test.ts` - the cases of this task.
- `UPDATE: docs/server/CONFIGURE.md` - what `configure` asks about a person, and what it prints at the end.

## Steps

1. Add `roleNames()` to `fileUsers`, and use one helper for it and for the two places at L1303 and L1559.
2. After the marketplaces question, ask `confirm('Add a person now?', false, ...)`.
3. On a yes, ask `ask('Their id', ...)`, and refuse an empty id with a line that says so.
4. Ask `ask('Roles (<roleNames, comma-separated>)', 'member', ...)`, and split the answer on commas.
5. When the file sets no `users`, set `held.users` to `join(options.configDir, 'users.json')`.
6. Open `fileUsers` on that path, and add the person with `directory.add(id, roles, {})`.
7. On a refusal of `add`, say its words and ask the roles again.
8. Repeat from step 2, so one run can add more than one person.
9. Return the ids added as `added` on `Configured`.
10. At the end of `configure`, say `ahpd user token <id> --url` for each id in `added`.
11. In `declareConfigure`, say `ahpd start` after the run, and do not say it in `offerConfigure`.
12. Add the `configure` part of `docs/server/CONFIGURE.md` for the person question and the closing lines.

## Validation

- A case: Enter at every question adds no person, writes no `users` key, and says no token line.
- A case: a yes, an id and Enter add the person as `member` to `<config dir>/users.json`.
- The same case: the configuration names that file in `users`.
- A case: a role list with a comma gives the person both roles.
- A case: an unknown role gets the refusal that names the host's roles, and the question comes again.
- A case: the run says `ahpd user token <id> --url` for the person it added.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17. `people` in `user.ts` and `configure` open the users file through one helper, `usersAt`, so both read `issuer` and `tokensPerPerson` the same way.
`roleNames` is optional on `Users`, because the test stand-ins of `Users` in other packages do not have it.

