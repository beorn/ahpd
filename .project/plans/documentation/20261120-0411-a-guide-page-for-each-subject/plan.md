---
title: A guide page for each subject
domain: documentation
status: dropped
priority: high
created: 2026-11-20
revalidated: 2026-11-20
requires: []
changes: []
creates: []
decisions: []
refs:
  - git://9f2a02ce8 - the last commit that holds the brief `briefs/a-guide-page-for-each-subject.md`, which this plan covers
  - "[code://docs/README.md](../../../../docs/README.md) - the index, which gets a `guide` section first"
  - "[code://docs/.vitepress/config.mts#L18-L117](../../../../docs/.vitepress/config.mts#L18-L117) - the sidebar, which gets a Guide group first, and the check that every page is in a group"
  - "[code://docs/index.md](../../../../docs/index.md) - the home page, which gets a Guide card first"
  - "[code://README.md](../../../../README.md) - the root README, whose capability titles move to the guide pages"
  - "[code://docs/server/GET-STARTED.md](../../../../docs/server/GET-STARTED.md) - a page for a person who runs ahpd, the voice the guide pages follow"
  - https://diataxis.fr/explanation/ - an explanation page says what a thing is and why, and links the reference
---

Dropped on 2026-11-20: Softov meant a server page for each command group that has none, not a guide of subjects. "maybe we dont need a /guide but on server we need the missing pages."

## Goal

A person who wants to know what ahpd does reads one page for each thing it does.
Each page says what the thing is, why a person uses it, how it works, and the commands and settings that drive it.
The pages are in a new `docs/guide/` folder, first in the site, and the root README's capability titles link them.
They land before 0.15.0.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- The docs are in three folders, one for each kind of reader.
- No page is for a person who wants to know what ahpd does.
- A subject is spread across folders. Spending is `server/USAGE.md`, `sdk/USAGE.md` and `sdk/POLICY.md`.
- The build throws when a page under `docs/` is in no sidebar group, so the guide's pages and its group go in together.
- The root README's capability titles link today's pages, on #390.

### Searches performed

- `ls docs/server docs/sdk docs/plugins` - the pages each subject is drawn from, listed in *Subjects*.
- `rg -n "sidebar|UNLISTED|missing" docs/.vitepress/config.mts` - one group per folder, and the check.

### Gaps

- No `docs/guide/` folder, no Guide sidebar group and no Guide card.
- The README links pages written for a developer.

## Subjects

| Page | Subject | Drawn from |
| --- | --- | --- |
| `SESSIONS.md` | Sessions that keep running when no client is connected | `sdk/SESSIONS.md`, `sdk/CHATS.md` |
| `CLIENTS.md` | Clients on any device: the web UI, the desktop app, ahpc, the phone app, VS Code | `server/CONNECT.md` |
| `REMOTE.md` | Remote access: the token, tunnels, another network | `server/REMOTE.md`, `plugins/tunnel-devtunnel.md` |
| `DIAGNOSTICS.md` | Status, doctor, logs and telemetry | `server/RUN.md` |
| `AGENTS.md` | Agents: Claude, pi, ACP agents, cofold, and a custom one | `server/PLUGINS.md`, the four agent pages |
| `SUBSCRIPTIONS.md` | Subscriptions or API keys | `plugins/agent-claude.md`, `server/VAULT.md` |
| `GATEWAY.md` | The model gateway | `server/GATEWAY.md` |
| `PLUGINS.md` | Plugins: install, configure, write | `server/PLUGINS.md`, `plugins/PLUGINS.md` |
| `BOTS.md` | Bots: a talk, its Front and its Back | `plugins/BOTS.md` |
| `MACHINES.md` | Isolated machines | `plugins/COMPUTERS.md`, `plugins/CONTAINERS.md` |
| `AUTOMATION.md` | Automation: schedules and webhooks | `sdk/AUTOMATIONS.md`, `plugins/WEBHOOKS.md` |
| `ACCESS.md` | Users, teams, roles and permissions | `server/USERS.md`, `sdk/USERS.md`, `sdk/AUTHENTICATION.md` |
| `SPENDING.md` | Usage and limits | `server/USAGE.md`, `sdk/USAGE.md`, `sdk/POLICY.md` |

## Page shape

- A title, then one paragraph: what the thing is, and why a person uses it.
- *How it works*: what happens, in the words a user meets, with no type or method names.
- *Commands and settings*: the commands, flags and configuration keys that drive it, each with one line.
  Each links `server/REFERENCE.md` or the page that holds it.
- *More*: links to the server, sdk and plugin pages for the detail.
- A page copies no table and no paragraph of another page. It links them.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A page per subject, for a person who uses ahpd | Softov, 2026-11-20: "One page per subject" | 01-04 |
| The pages land before 0.15.0 | Softov, 2026-11-20: "Before 0.15.0" | 01-04 |
| They live in a new `docs/guide/` section, first in the index, the sidebar and the home page | Softov, 2026-11-20: "A new docs/guide/ section" | 01 |
| The 13 subjects of *Subjects* | Softov, 2026-11-20: "The 11, plus bots and remote access" | 01-03 |
| The root README's capability titles link the guide pages | Softov, 2026-11-20, in the brief | 04 |
| A guide page links the detail and copies none of it | (defaulted: a fact is written in one file) | 01-03 |
| The page shape of *Page shape* | (defaulted: Softov's "what it is, why, how it works, the commands that drive it") | 01-03 |
| The sidebar labels are the subjects in plain words, as "Sessions", "Remote access" | (defaulted: the voice of the README's titles) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the guide section and its running pages](task-01-the-guide-and-its-running-pages.md) | todo | - |
| [02 - the agent and model pages](task-02-the-agent-and-model-pages.md) | todo | 01 |
| [03 - the work and control pages](task-03-the-work-and-control-pages.md) | todo | 01 |
| [04 - the README links the guide](task-04-the-readme-links-the-guide.md) | todo | 02, 03 |

## Risks and tradeoffs

- 13 pages before 0.15.0 is the largest docs change of the release. Each task is reviewable alone.
- A guide page states facts the code holds, so each one is checked against the code and the linked page, not written from memory.
- The README links move twice: to today's pages in #390, then to the guide in task 04.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-guide-and-its-running-pages.md](task-01-the-guide-and-its-running-pages.md).
- **Open questions:** none.
- **Watch out for:** the build throws for a page in no sidebar group; add each page and its sidebar entry in the same commit.

## Final verification checklist

- [ ] `pnpm docs:build` passes, and the site shows the Guide first, with its 13 pages.
- [ ] Each guide page has the four parts of *Page shape*, and every link resolves.
- [ ] Each fact on a guide page matches the code or the page it links.
- [ ] The root README's eleven capability titles open guide pages.
- [ ] Softov reads the 13 pages.
