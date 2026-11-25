---
title: An agent builds an app that lasts
created: 2026-11-21
refs:
  - git://22491eb0d - main when the facts were checked
  - "[briefs/plugin-runtimes-external.md](plugin-runtimes-external.md) - a plugin that runs outside the daemon's process, which the app runs on"
  - "[briefs/a-plugin-asks-for-its-grants.md](a-plugin-asks-for-its-grants.md) - a plugin's own grants, written by hand today"
  - "[briefs/an-agent-makes-a-canvas.md](an-agent-makes-a-canvas.md) - canvases an agent makes"
  - "[briefs/a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) - a plugin's page and its actions"
  - "[briefs/a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) - the first app, written as the app, with what it misses"
  - "[briefs/agent-extensions-are-a-sessions-plugins.md](agent-extensions-are-a-sessions-plugins.md) - the VS Code methods that list ahpd plugins"
  - "[research/vscode-extensions-plugins-and-customizations.md](../research/vscode-extensions-plugins-and-customizations.md) - an ahpd plugin, an agent plugin and an agent extension, told apart"
  - "[code://packages/server/src/pluginschannel.ts#L232-L235](../../packages/server/src/pluginschannel.ts#L232-L235) - the grants that guard each plugin command"
  - "[code://packages/server/src/pluginschannel.ts#L614](../../packages/server/src/pluginschannel.ts#L614) - a plugin's folder, `<plugin root>/plugins/<id>/`"
  - "[code://packages/server/src/plugins.ts#L2173](../../packages/server/src/plugins.ts#L2173) - `enabled: false`, the top-level switch"
  - "[code://packages/sdk/src/plugins/enablement.ts](../../packages/sdk/src/plugins/enablement.ts) - on and off by global, folder and session scope"
  - "[code://packages/sdk/src/plugins/views.ts](../../packages/sdk/src/plugins/views.ts) - plugin views as schema data models"
  - "[code://packages/sdk/src/types/plugin.ts#L1319](../../packages/sdk/src/types/plugin.ts#L1319) - `registerTool`"
  - file:///github/ahpd/.scratch/dsh-todo-app - the dsh plugin Softov pointed at, a todo page in dsh's sidebar
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/agent.ts#L368`, `AgentExtensionMode`; `node/copilot/copilotExtensionTools.ts`, `extensions_reload`
---

# An agent builds an app that lasts

Softov wants an agent in a session to build an app, such as a todo page with its own data, as an ahpd plugin. The app stays after the session ends, and other sessions use it and change it. In his words: "a app made in one session must survive like forever or be changed by others sessions." In 0.17 the app runs on the stdio runtime, with the same plugin shape as today: "just the communication need to be solved."

## What others do

- **dsh** loads a plugin as a package with a host half and a client half. In `dsh-todo-app`, the host half is `export function apply() {}`. The client half registers a sidebar row and a main panel in React, with its data in the browser's storage. Softov does not want the client injection for now.
- **VS Code** lets Copilot's agent write an agent extension and load it with `extensions_reload`. Its extension list has a `mode` per provider: `disabled`, `load_only` or `load_and_augment`.

## What ahpd has today

- A plugin runs in the daemon's process, loaded with `import()`. It can do what the daemon's OS user can do: its grants limit only the calls on its connection.
- A plugin talks to the host over a connection, an in-memory pair served as `plugin:<name>`. Its registrations, such as tools, agents and channels, are calls into the host, not frames. A nested host already speaks AHP over stdio.
- A plugin lives in `<plugin root>/plugins/<id>/`, under the configuration folder or `AHPD_PLUGIN_ROOT`. ahpd has no per-user or per-team folders.
- The plugins channel guards each command with a grant: `plugin:list` to read, `plugin:enable` and `plugin:disable` to switch, and `plugin:install` to install or remove. No group holds `plugin:install`.
- A plugin has no creator or owner.
- `enabled: false` on a plugin's entry turns it off for the host. A decision by global, folder or session scope can switch it off, but a plugin is never loaded for one session only.
- A plugin shows views as schema data models, and registers host tools with `registerTool`.
- No tool loads a plugin an agent wrote, and no skill teaches an agent to write one.

## The change

- An agent writes an app as an ahpd plugin. A tool such as `plugin_load` or `plugin_import` loads it later. Softov, 2026-11-22: "plugin_load can wait for now", because an agent can already write a plugin and a person with the grant adds it.
- The first app is a todo app, because it has create, read, update, delete and storage. The app needs a way to render, its UI context, and a way to take actions. All of it can go in 0.17. Softov, 2026-11-22. [a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) writes the app and lists what is missing.
- The app runs on the stdio runtime from 0.17, with the plugin shape of today. The registrations that are calls today become messages. Softov, 2026-11-22.
- All apps are kept in one folder beside the plugins, and each records its owner: a user, a team or the host. Softov, 2026-11-22, "One folder, owner recorded (Recommended)".
- Root may always change or remove an app, and so may the user who created it. Softov, 2026-11-22.
- The gate stays this simple for now, and team grants get a later brief. Softov, 2026-11-22: "gate simple now, team grants in a later brief".
- A plugin's tools can be turned off for the host while the plugin keeps running. Softov, 2026-11-22: "to leave the plugin running and to disable only the tools."
- VS Code's `mode` maps onto these switches. `disabled` is the plugin off, and `load_only` is the plugin running with its tools off. `load_and_augment` is the plugin with its tools on. Read from the type's names and comment, not from Copilot's code.

## Open points

- Which tools a session gets, per session. Softov, 2026-11-22: it waits for another brief and an idea of his, which change how a session's tools are controlled.
- Not asked yet: the schema of each UI kind, and the storage functions' shape and scope.
- Not checked: how Copilot acts on `load_only` against `load_and_augment`.
