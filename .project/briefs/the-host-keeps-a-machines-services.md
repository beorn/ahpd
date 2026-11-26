---
title: The host keeps a machine's services
created: 2026-11-25
refs:
  - git://5ae0ec13e - main when the facts were checked
  - git://999571657 - beorn/ahpd main, where the services and deploy plugins were read
  - https://github.com/ahpio/ahpd/pull/474#issuecomment-7176745512 - beorn's proposal of 2026-11-25 22:45 UTC, the last comment on #474
  - "[briefs/the-host-keeps-the-tunnels.md](the-host-keeps-the-tunnels.md) - the pattern beorn's proposal copies: the host keeps the list, a plugin adds a kind"
  - "[briefs/a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) - Softov's lists and kinds, of which services would be one list"
  - "[briefs/a-crm-is-the-second-example-kind.md](a-crm-is-the-second-example-kind.md) - the second example of lists and kinds"
  - "[code://packages/sdk/src/types/tunnels.ts#L132-L201](../../packages/sdk/src/types/tunnels.ts#L132-L201) - `TunnelKind`, the one kind a plugin registers today"
  - "[code://packages/sdk/src/tunnels/channel.ts#L319](../../packages/sdk/src/tunnels/channel.ts#L319) - `operationsOf`, the host's operations and then each kind's own"
  - "[code://packages/sdk/src/types/plugin.ts#L380](../../packages/sdk/src/types/plugin.ts#L380) - `PluginChannel.operations`, from #476: a list one plugin serves"
  - "[code://packages/server/src/service.ts#L1-L20](../../packages/server/src/service.ts#L1-L20) - `ahpd service`, the daemon as the machine's own service, which already uses the word"
  - https://f1bonacc1.github.io/process-compose/ - process-compose, the supervisor beorn's plugin drives (not fetched for this brief)
  - https://capistranorb.com/documentation/getting-started/structure/ - Capistrano's releases folders and `current` link, the layout beorn's deploy plugin uses (not fetched for this brief)
---

# The host keeps a machine's services

beorn runs many agents on ahpd and wants to move their own infrastructure into it: a machine's services first, then their deploys. They proposed the shape on #474 on 2026-11-25, and offer their plugins back through `ahpio/plugins`. This brief sets the proposal beside Softov's lists and kinds, so Softov can choose the shape before beorn builds more. Nothing is built from it yet.

## beorn's proposal

Their words on #474, as statements:

- The host owns a list, `services: [{ name, kind, spec }]`.
- A kind plugin, such as process-compose or systemd, does start, stop, status and restart for its entries, as a tunnel kind does.
- Deploy is a host operation over any service entry, and not part of a kind.
- A deploy fetches, builds, switches and checks, rolls back on a failed check, and keeps the last N releases.
- A service entry may carry a deploy declaration: `repo`, `build`, `check` and `keep`. Kind-specific settings stay in `spec`.
- They want it to work with ahpw and any AHP client. Their own client is Hightea, and they have not decided whether it will be open source.

## What others do

- **systemd and launchd** keep a machine's services as unit files.
  One command starts, stops or asks for the state of each. ahpd already writes one for itself with `ahpd service install`.
- **process-compose** keeps the services in a YAML file and serves start, stop and logs over a socket. It ignores keys that start with `x-`.
- **Capistrano** deploys a release into its own folder, switches a `current` link, and keeps the last N folders. beorn's deploy plugin does the same.

## What ahpd has today

- **Tunnels** are the one list the host keeps with kinds from plugins. A kind is a `TunnelKind`, with a `schema`, its own `operations` and the handlers the host calls. The host owns the channel, the records and the grants.
- **A registered channel** can offer operations since #476. It is one plugin's list, its operations name no kind, and a second plugin cannot join it.
- **Lists and kinds** are Softov's design in the todo and CRM briefs, with `registerList` and `registerKind`. A list is a channel the host keeps, which any plugin may declare and add kinds to. Softov does not want them built now (2026-11-25).
- **The word "service"** already names the daemon as the machine's own service: `ahpd service install`, `start`, `stop` and `restart`.

## What beorn has today

Read on their fork's `main`, `999571657`. Nothing of it is in `ahpio/ahpd`.

| Package | What it is |
| --- | --- |
| `packages/services`, published as `@hallohuman/hightea-services` | One channel, `x-hh-services://`, with one row per process-compose service. Its operations are `put`, `remove`, `start`, `stop`, `restart` and `accept`. It also alerts on drift between the file and what runs. |
| `packages/deploy`, published as `@ahpd/deploy` | One channel, `x-hh-deploys://`, with one operation, `deploy`, which takes `{ service, version }`. A run answers at once and goes on in a child process; its journal is `hh-deploys://<id>/log`. |

- The service record is neutral, so that another supervisor can carry it. Its deploy declaration is written in the process-compose file as `x-hh-deploy`.
- Both packages run on Linux and macOS only.
- Both are built on #476, and on `caller` from their fork's PR #36, which `ahpio/ahpd` does not have.

## Who writes

- **beorn's fork** holds both packages. A host list means the services plugin becomes a kind, and its channel and its operations move to the host.
- **Hightea** reads `x-hh-services://` and `x-hh-deploys://` today, and would read the host's channel instead.
- **ahpw** has no page for either. A host list draws as the tunnels do, with no code for services.
- **No open branch of `ahpio/ahpd`** touches tunnels, kinds or `service.ts`.

## The change

As beorn proposes it, with tunnels as the model:

- The host keeps the services of its own machine on one channel, and serves create, update and remove with each kind's `schema` as their form.
- A plugin registers a kind of service with the handlers the host calls, as `TunnelKind` does.
- The host owns the grants and the record, and a kind owns what a service of it is.
- Deploy is one operation the host offers on every service with a deploy declaration, whatever its kind.

## Open points

1. **Which shape.** Services is one list of [a-list-and-its-kinds.md](a-list-and-its-kinds.md), with process-compose and systemd as kinds, as its *Example: a machine's services* writes it. When it is built is open.
2. **Who owns deploy.** beorn calls it a host operation, and offers it as a plugin. A plugin that adds an operation to every row of a list it does not own is new in ahpd: tunnels have no such thing.
3. **Running commands.** `build`, `before_switch` and `check` are commands the host runs. beorn keeps them on the service record, so `deploy:deploy` alone chooses no command. Who may write the declaration then decides who may run code on the machine.
4. **The word.** "Service" already names `ahpd service`. The list may need another word, such as "program".
5. **One machine or many.** Each host keeps its own machine's services in beorn's plugins. A list across machines is a different design.
6. **Where the plugins live.** beorn offers them through `ahpio/plugins`. The kind for process-compose and the deploy part could live there, and the host list in `ahpio/ahpd`.
7. **`caller`.** Their services log names who made a change from `caller.owner`. In ahpd that is the plugin when a plugin relays the call, never the person it acts for.
