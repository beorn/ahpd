# Teams and projects

Group people, and say what their work is charged to. A team or a project is a name in the users file that a person's memberships, the usage pools, the policies, tokens and vault names refer to.

```bash
ahpd team add web --title "Web"
ahpd project add checkout --title "Checkout"
ahpd user member ana web:checkout
```

| Command | Does |
| --- | --- |
| `ahpd team list` | Show the teams this install names |
| `ahpd team add <id>` | Name a team. `--title` is what a client shows; without it, the id |
| `ahpd team rm <id>` | Take a team out. Refused while a membership names it, saying who holds it |
| `ahpd project list` | Show the projects this install names |
| `ahpd project add <id>` | Name a project, with `--title` as for a team |
| `ahpd project rm <id>` | Take a project out. Refused while a membership names it |

`add` on a name that is already there sets its title and moves nothing.

## Memberships

A membership is a team, or a team and a project: `web` or `web:checkout`. A person holds one or more, and one of them is their primary.

| Command | Does |
| --- | --- |
| `ahpd user member <id> <team[:project]>...` | Set the teams and projects a person's work may be charged to |
| `ahpd user primary <id> [team[:project]]` | Set where their work is charged when it names no team or project |

A session is charged to the team and project its `scope` names, or to its owner's primary membership when it names none. See [Users](USERS.md) for the people themselves.

## What a team is used for

| Where | What it does |
| --- | --- |
| [Usage](USAGE.md) | Each team and project is a pool, `team:<id>` and `project:<team>:<project>`. A member reads the pools of their own teams and projects |
| [Policies](../sdk/POLICY.md) | A row's scope may be `team:<id>` or `project:<team>:<project>`, so a limit or a rule holds for the members alone |
| [Tokens](USERS.md#tokens-of-their-own) | `ahpd token mint --team <team>` mints a team's own key, and `--scope` charges a key to a team and project |
| [Vault](VAULT.md#names) | A `team:<team>/<name>` secret is the team's, written by its members with `team:write` |

## More

- [The user directory](../sdk/USERS.md): people, roles, memberships and grants, in full.
- [Reference](REFERENCE.md): every flag of these commands.
