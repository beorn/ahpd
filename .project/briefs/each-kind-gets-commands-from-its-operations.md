---
title: Each kind gets commands from its operations
created: 2026-11-20
replaces:
  - briefs/connectors-and-agents-from-the-cli.md
refs:
  - git://d5e791099 - the commit of ahpd the facts were checked at
  - git://5ec505054 - the last commit that holds `briefs/connectors-and-agents-from-the-cli.md`, which this brief replaces
  - "[code://packages/server/src/commands/registry.ts#L60-L84](../../packages/server/src/commands/registry.ts#L60-L84) - `cliRegistry`, the 22 command groups `ahpd` declares"
  - "[code://packages/server/src/commands/served.ts#L126-L143](../../packages/server/src/commands/served.ts#L126-L143) - `servedRegistry`, the 15 of them served under `/api`, from the same declarations"
  - "[code://packages/sdk/src/kinds/operations.ts](../../packages/sdk/src/kinds/operations.ts) - the operations a channel lists, and `x-ahpd/invokeOperation`, which runs them"
  - "[code://packages/sdk/src/types/kinds.ts#L104-L115](../../packages/sdk/src/types/kinds.ts#L104-L115) - `Operation`: its id, its grant, its scopes and its input schema"
  - "[code://packages/server/src/commands/plugin.ts#L185-L200](../../packages/server/src/commands/plugin.ts#L185-L200) - `plugin apply`, a local command that calls the recorded daemon's `/api`"
  - "[code://packages/server/src/commands/vault.ts#L152-L190](../../packages/server/src/commands/vault.ts#L152-L190) - `vault set`, which reads a secret from standard input"
  - https://cli.github.com/manual/gh_auth_login - `gh auth login` signs in at a terminal with a device code or a pasted token
---

# Each kind gets commands from its operations

Softov wants a shell to manage every kind the host keeps, such as agents, connectors, computers and bots, as it manages users and plugins. The CLI and the HTTP API are one definition, so a kind gets its commands from the operations it already declares, with no second declaration. The work lands in 0.16.

## What others do

- `gh auth login` signs in at a terminal. It prints a code and a URL, or reads a token from standard input, and waits for the approval.
- ahpd's own commands are one declaration each in `@cofold/commands`: a CLI pattern, an HTTP path and the help text.

## What ahpd has today

- The CLI and the HTTP API agree. Both are built from the same declarations in `packages/server/src/commands/`. `cliRegistry` declares 22 groups, and `servedRegistry` serves 15 of them under `/api`. Every command declares a CLI pattern and an HTTP path. The seven only the CLI has are local by design: the foreground run, `start`, `stop`, `doctor`, `service`, `configure` and `join`.
- Only that registry answers under `/api`. The other HTTP roots are `/v1`, the model gateway, `/mcp`, the session tools, and `/plugins/`, the routes a plugin registers.
- No command manages an agent, a connector, a computer, a bot, a tunnel, a client, a push device, a task, a role or a policy. Each is reached over AHP only, as ahpw reaches it. `/mcp` has a read-only `list_agents`.
- The kinds are a second definition system, in `@ahpd/sdk`. A channel lists its operations in its state, each with an `id`, a `label`, a `grant`, its `scopes` and an `input` JSON Schema. `x-ahpd/invokeOperation` runs one.
- Four channels list operations: `x-ahpd-agents`, `x-ahpd-connectors`, `x-ahpd-tunnels` and `x-ahpd-clients`.
- Bots have their own methods, `x-ahpd/bots/put` and `x-ahpd/bots/remove`, and list no operations. Computers are made through `computer://` resource writes and the agent's tools, and list no operations.
- A local command reaches the running daemon through the daemon's recorded `/api`, as `plugin apply` does. That needs `httpApi` on.
- A secret comes on standard input, never on the command line, as `vault set` takes a value.

## Who writes

- The command declarations are in `packages/server/src/commands/`, and the operations in `packages/sdk/src/kinds/` and each channel. No open branch of `ahpio/ahpd` changes either.
- `plugins/20261112-0221-a-record-draws-the-operations-it-offers` in ahpw reads the same operations to draw a record's buttons. A command and a button then come from one list.

## The change

- One bridge in `packages/server` turns each operation a channel lists into a command, `ahpd <kind> <operation>`, and an `/api` route.
  Both come from the operation's id, grant and input schema.
- A kind or an operation that a plugin adds gets its command with no code in `packages/server`.
- A command sends the operation to the running daemon's `/api`. Without `httpApi`, it says to turn it on. `--remote` works the same.
- A field of the input schema that is a secret comes on standard input.
- A list command shows each record of the channel, from its state.
- Bots and computers list their operations, so the bridge covers them too.
- A sign-in operation prints the URL or the code, and waits for the approval, as `gh auth login` does.

## Answers

| What | Source |
| --- | --- |
| Commands come from the kinds' operations, through one bridge | Softov, 2026-11-20: "From the kinds' operations" |
| Every kind with operations, with no list of kinds | Softov, 2026-11-20: "Every kind with operations" |
| A command reaches the daemon through its `/api`, as `plugin apply` does | Softov, 2026-11-20: "The daemon's /api, as plugin apply" |
| The work lands in 0.16 | Softov, 2026-11-20: "After 0.15.0, in 0.16" |
| The CLI and the HTTP API stay one definition | Softov, 2026-11-20: "they are suppose to be/use the same definition" |
| Bots and computers list operations, so the rule covers them | (defaulted: "every kind with operations" and Softov's four kinds agree only then) |
| A secret field comes on standard input | (defaulted: as `vault set`) |
