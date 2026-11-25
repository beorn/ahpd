---
title: Configure turns the policy checks on and writes starter rows
status: done
depends: [task-01-configure-adds-a-person.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L939](../../../../packages/server/src/config.ts#L939) - `policiesPath`, which takes no folder today"
  - "[code://packages/sdk/src/access/policies.ts#L318-L368](../../../../packages/sdk/src/access/policies.ts#L318-L368) - `filePolicies`, with `list` and `put`"
  - "[code://packages/sdk/src/access/decide.ts#L166-L180](../../../../packages/sdk/src/access/decide.ts#L166-L180) - `matched`: an empty match allows nothing"
  - "[code://docs/sdk/POLICY.md#L104-L120](../../../../docs/sdk/POLICY.md#L104-L120) - *What is checked, and where*"
---

## Objective

On a host with a `users` file, `configure` asks whether to turn the policy checks on.
With the check on, it offers one starter row for each kind that would refuse every person.

## Files

- `UPDATE: packages/server/src/config.ts:939` - `policiesPath(dir = configDir())`.
- `UPDATE: packages/server/src/commands/configure.ts` - the check question, the starter rows question, and the rows.
- `UPDATE: packages/server/test/server-configure.test.ts` - the cases of this task.
- `UPDATE: docs/server/CONFIGURE.md` - what `configure` asks about policies, and what it writes.
- `UPDATE: docs/sdk/POLICY.md` - a session needs an `agent` row and a `computer` row, and no computer means `host`.

## Steps

1. Give `policiesPath` a folder argument, with `configDir()` as its default.
2. After the person questions, ask `confirm('Turn the policy checks on? A person no policy allows is refused.', <held value>, ...)`.
3. Ask that question only when `held.users` names a file.
4. Write the answer to `held.policies.check`, and keep the other keys of `policies`.
5. With the check on, open `filePolicies` on `policiesPath(options.configDir)` and list its rows.
6. List each kind among `agent`, `computer` and `model` with no `all` allow row of `*` for its own value type.
7. For those kinds, ask one `confirm` that names them.
8. Make that question say that a `model` row opens every model to every person.
9. Make Enter on that question a yes.
10. On a yes, `put` one row per kind: `everyone-<kind>`, scope `all`, effect `allow`, `*` for the kind's value type.
11. When the store holds a different row under that id, say so and skip that kind.
12. After a run that wrote a row, say that the rows count from the next start of the daemon.
13. Add the policy part of `docs/server/CONFIGURE.md`.
14. Add one sentence to `docs/sdk/POLICY.md` beside its table of checks: a session needs both rows.
15. Add one more sentence there: `host` stands for a session that names no computer.

## Validation

- A case: a host with no `users` file is not asked about the checks.
- A case: a yes to the check writes `policies.check: true` and keeps `payOrder`.
- A case: with the check on and an empty store, Enter writes `everyone-agent`, `everyone-computer` and `everyone-model`.
- A case: a store with an `all` agent row of `agent: ["*"]` gets only the `computer` and `model` rows.
- A case: a store with a different `everyone-agent` row keeps it, and the run says that it skipped the kind.
- A case: with the check off, the run offers no row and does not open the store.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

Built on 2026-11-17. A No on a file that never named `policies.check` writes no `policies` key, so Enter at every question leaves the file as before.
A row with a `from` or an `until` does not count as one that allows every person, since it is not active at all times.

