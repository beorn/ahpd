---
title: Plugin contract
status: current
covers:
  - packages/sdk/src/plugins/plugins.ts
  - packages/sdk/src/types/plugin.ts
  - packages/sdk/src/types/events.ts
  - packages/sdk/src/utils/frozen.ts
  - packages/sdk/src/resources/records.ts
  - packages/sdk/src/types/records.ts
  - packages/server/src/records.ts
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L351-L366](../../packages/sdk/src/types/plugin.ts#L351-L366) - `PortKey`, the ports a plugin can set"
  - "[code://packages/sdk/src/types/plugin.ts#L429-L502](../../packages/sdk/src/types/plugin.ts#L429-L502) - `PluginContext`"
  - "[code://packages/sdk/src/types/plugin.ts#L527-L847](../../packages/sdk/src/types/plugin.ts#L527-L847) - `PluginHost`, every registration and call"
  - "[code://packages/sdk/src/types/plugin.ts#L862-L886](../../packages/sdk/src/types/plugin.ts#L862-L886) - `Plugin`, what a module exports"
  - "[code://packages/sdk/src/types/events.ts#L29-L48](../../packages/sdk/src/types/events.ts#L29-L48) - `EventName`, the events a plugin can hear"
  - "[code://packages/sdk/src/plugins/plugins.ts#L330-L416](../../packages/sdk/src/plugins/plugins.ts#L330-L416) - the fold of all contributions into one set of host options"
  - "[code://packages/sdk/src/plugins/plugins.ts#L748-L755](../../packages/sdk/src/plugins/plugins.ts#L748-L755) - `pluginHost`, and YAML functions that throw on a host with none"
  - "[code://packages/sdk/src/plugins/plugins.ts#L964-L975](../../packages/sdk/src/plugins/plugins.ts#L964-L975) - `records`, one collection per name"
  - "[code://packages/sdk/src/plugins/plugins.ts#L990-L1022](../../packages/sdk/src/plugins/plugins.ts#L990-L1022) - `startSession` and `connect`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1157-L1170](../../packages/sdk/src/plugins/plugins.ts#L1157-L1170) - `registerClose`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1225-L1233](../../packages/sdk/src/plugins/plugins.ts#L1225-L1233) - the frozen `host` and the `seal` call"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1248-L1280](../../packages/sdk/src/plugins/plugins.ts#L1248-L1280) - `raise`, one frozen event for every listener"
  - "[code://packages/sdk/src/utils/frozen.ts#L18-L54](../../packages/sdk/src/utils/frozen.ts#L18-L54) - `frozenCopy` and `deepFreeze`"
  - "[code://packages/sdk/src/host.ts#L1139-L1192](../../packages/sdk/src/host.ts#L1139-L1192) - `close`, the order of what stops"
  - "[code://packages/server/src/plugins.ts#L895-L943](../../packages/server/src/plugins.ts#L895-L943) - the frozen context, `apply` and `seal`"
  - "[code://packages/server/src/commands/run.ts#L1036-L1064](../../packages/server/src/commands/run.ts#L1036-L1064) - `listening`, raised before the announcement"
  - "[code://packages/server/src/commands/run.ts#L893-L907](../../packages/server/src/commands/run.ts#L893-L907) - `say`, lines kept for the announcement"
  - "[code://packages/server/src/records.ts#L30](../../packages/server/src/records.ts#L30) - `RESERVED_COLLECTIONS`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-plugin-gets-frozen-copies-of-host-values, a-plugin-gets-yaml-from-the-host, a-plugin-hears-input-needed-though-a-client-does-too, a-plugin-hears-the-listener, a-plugin-is-told-when-the-host-closes, a-plugin-keeps-records-in-the-host-store, a-plugin-starts-a-session-as-an-owner, plugin-contract-lives-in-the-sdk, plugin-contributes-host-options, plugin-events-are-observed-not-answered, plugin-registration-kinds, the-sdk-re-exports-yaml, yaml-lives-in-server
---

A plugin is a module that exports `apply(host, options)`, and the contract it is written against is in `@ahpd/sdk`.
The loader gives each plugin its own `PluginHost` and a frozen `PluginContext`.
During `apply` the plugin makes contributions: agents, tools, ports, resource providers, channels, commands, routes, closers and event listeners.
After every plugin has applied, the fold joins all contributions into one set of host options.
A plugin then runs as a guest: it hears events, opens record collections, starts sessions and connects as a client.
The types are in [`code://packages/sdk/src/types/plugin.ts`](../../packages/sdk/src/types/plugin.ts), and the plugin host is in [`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts).

## Scenarios

### The contract is in the sdk

WHEN a plugin imports its types and helpers
THEN it imports them from `@ahpd/sdk`, the package the daemon also builds its host on
AND the sdk depends only on `@microsoft/agent-host-protocol`, with `ws` as an optional dependency.

The daemon reads an error by its name `RpcError` and its numeric code, not by `instanceof`.
This is so that a plugin with its own copy of the sdk throws errors the daemon understands.

### A plugin registers contributions

WHEN a plugin calls `registerAgent`, `registerTool`, `registerSessionConfig` or `registerChatPreamble`
THEN the host appends the item to the matching list.

WHEN a plugin calls `register<Port>` for one of the 15 ports, such as `registerResources` or `registerVault`
THEN the plugin sets that port
AND a second plugin that sets the same port is a problem line, unless it passes `'replace'`.

WHEN two plugins register an agent with the same provider
THEN the first keeps it, and the second agent is dropped with a problem line.

WHEN a plugin calls `on(event, handler)`
THEN the host adds a listener for that event.

WHEN a registration fails its check during `apply`
THEN the whole contribution of that plugin is discarded, and the plugin costs one problem line.

WHEN a plugin calls a `register*` method after `apply` returned
THEN the host refuses it in the plugin's name, because the fold has already taken its copies.

The ports are resources, terminals, changes, directories, worktrees, github, automations, sessions, diagnostics, computers, containers, usage, policies, vault and records.
A registration takes no context argument, because the plugin got its context with `apply`.

### A plugin gets frozen values

WHEN the loader hands a plugin its context
THEN the context is frozen, and `paths` is a frozen copy of the directories the host serves.

WHEN the host gives a plugin an event, or keeps a tool definition a plugin gave it
THEN the value is a deep copy, frozen through and through.

WHEN a plugin writes to a value it was given
THEN the write throws, because ESM code runs in strict mode.

The reason: the host never hands a plugin an object the host reads again later.
This guards host state against a plugin's writes.
It is not a sandbox, because code in the same process can still read files and the environment.

### A plugin gets YAML from the host

WHEN a plugin needs to read or write YAML
THEN it calls `parseYaml` and `stringifyYaml` on its context.

The daemon fills them from `@cofold/yaml`, which is a dependency of `@ahpd/server` and not of the sdk.

WHEN a host built from the sdk alone gives no YAML functions
THEN both functions throw and say why.

This is so that a plugin needs no YAML dependency of its own, and the sdk stays free of one.

### A plugin hears events

WHEN the host raises an event
THEN each listener gets the same frozen copy, in registration order, and the host awaits each one
AND a listener that throws is reported against its plugin, and the next listener still runs.

WHEN a listener returns a value
THEN the host ignores it.

A listener observes and cannot refuse or change what the host does.
A plugin that needs to change a result contributes a tool, a port or an agent.
A slow listener slows the action it observes, because the host awaits it.

The events are `session_start`, `session_end`, `session_opened`, `turn_start`, `turn_end`, `message`, `tool_call`, `input_needed_set`, `input_needed_removed`, `client_connect`, `client_disconnect`, `authenticated`, `automation_fire`, `resource_write`, `users_changed`, `terminal_open`, `listening`, `stopping` and `log`.

### A plugin hears who opened a session

WHEN a client subscribes to a session, or to a chat of it, for the first time
THEN `session_opened` names the session and the client id
AND on a host with users it names `owner`, the person the connection signed in as.
A client id is the client's own word, so a plugin that ties a client to a person checks `owner` too, as `@ahpd/push` does.

### A plugin hears that a session needs a person

WHEN a backend's `session/inputNeededSet` passes through the host
THEN the host raises `input_needed_set` with the session, the chat, the request id and its kind
AND this happens even when a client also sees the request.

WHEN the request is answered or withdrawn
THEN the host raises `input_needed_removed` with the session and the request id.

A notifier can drop a repeat by the request id.
An event that repeats a state action exists only for a moment a plugin acts on without watching the session.

### A plugin hears the listener

WHEN the daemon has bound its socket
THEN it raises `listening` with `runtime`, `host`, `port` and `guarded`, before it announces itself.

WHEN a plugin calls `say(line)` while `listening` is handled
THEN the line goes into the daemon's announcement, after the daemon's own lines and in plugin order.

WHEN a plugin calls `say` after the announcement
THEN the line is dropped, because a late line on stdout would read as part of the parsed announcement.

WHEN the daemon runs over stdio
THEN it does not raise `listening`, because no address exists for anybody to reach.

WHEN the daemon stops
THEN it raises `stopping` before it closes the listener.

`log` writes to stderr for a person, and `say` writes to stdout for `ahpd status`.
`guarded` tells a plugin, such as a tunnel, that the daemon has a connection token of its own.

### A plugin stops with the host

WHEN a plugin calls `registerClose(close)` during `apply`
THEN the host calls `close` when it closes.

WHEN the host closes
THEN the sessions close and the machine calls settle first
AND then each plugin closer runs as one step, in registration order
AND then the users watch, the automation rules and the stores close.

WHEN one closer fails
THEN the failure is logged against its plugin, and the next closer still runs.

This is so that a plugin stops its timers and processes before the stores it writes through are gone.

### A plugin keeps records in the host store

WHEN a plugin calls `records(name)`
THEN it gets a collection with `get`, `list`, `find`, `put`, `remove` and `watch`.

WHEN the name is not a slug, or another plugin already opened that name
THEN the call is refused.

WHEN the name is `agentPlugins`, `automations`, `node_modules`, `sessions` or `usage`
THEN the daemon refuses it, because it keeps its own files in that folder.

In the daemon, each record is one Markdown file at `<configDir>/<name>/<id>.md`, with YAML frontmatter.
A call on the collection waits until the fold names the `records` port, so a plugin can open one during `apply`.

### A plugin starts a session for an owner

WHEN a plugin calls `startSession` with an owner
THEN the host asks for the owner's own `session:create` first
AND takes every step a client's `createSession` takes, and the session belongs to the owner.

WHEN the owner may not create a session
THEN the call is refused as it would be at the door.

WHEN a plugin calls `startSession` before a host is built over it
THEN the call throws.

A host with no users directory gates nothing here, as everywhere else.

### A plugin connects as a client

WHEN a plugin calls `connect()` from `listening` or later
THEN it gets an AHP peer in the same process, served as the principal `plugin:<id>` with the grants of its entry.

WHEN a plugin calls `connect()` during `apply`
THEN the call throws, because no host exists yet to accept the connection.

WHEN the daemon raises `stopping`
THEN it closes every plugin connection that is still open.
