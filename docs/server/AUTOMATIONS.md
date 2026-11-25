# Automations

Have the host start work on its own: on a schedule, on an event such as a webhook, or when you press run. An automation is one instruction, and each **run** is a session whose first message is that instruction. It runs with nobody connected.

```bash
ahpd automation list
ahpd automation export nightly-review --out nightly-review.automation.md
ahpd automation import nightly-review.automation.md --folder /work/project
```

| Command | Does |
| --- | --- |
| `ahpd automation list` | Show each automation: the id `export` takes, its name, its folder, its schedule and whether it is on |
| `ahpd automation export <id>` | Write an automation as ahpd's file, printed or to `--out`. `--vscode` writes VS Code's file, and is refused for one that file cannot hold |
| `ahpd automation import <file>` | Make a new automation from a file, switched off. It runs in `--folder`, or in the folder an ahpd file names. `--vscode` reads VS Code's file |

`list` prints one line for each:

```text
nightly-review  Nightly review  /work/project  0 9 * * * Europe/Berlin  on
```

An automation is made, edited and run from a client, such as the web UI or VS Code. The commands move one between hosts, and from or to VS Code.

## Where they are kept

Each automation is one Markdown file in `~/.config/ahpd/automations/`, named after its id. A running daemon follows an edit of a file at once. What a run changes, such as the next time a schedule fires, is in `automations-state.json` beside it, so a run never rewrites a file you are editing.

| Setting | What it does |
| --- | --- |
| `automations` (`--automations`) | `file`, the default, keeps them in that folder and fires their schedules. `memory` keeps them until the process ends and fires nothing |
| `unownedAutomations` (`--unowned-automations`) | What an automation that names no owner wakes on: `every`, the default, or `none` |

## Over the HTTP API

With the [HTTP API](REMOTE.md#http-api) on, the same commands are `GET /api/automation/list`, `GET /api/automation/export/{id}` and `POST /api/automation/import`, whose body carries the file as `text`.

## More

- [Automations](../sdk/AUTOMATIONS.md): the triggers, the runs, the owner, and the file format, in full.
- [Webhooks](../plugins/WEBHOOKS.md): a URL that fires an automation.
- [Reference](REFERENCE.md): every flag of these commands.
