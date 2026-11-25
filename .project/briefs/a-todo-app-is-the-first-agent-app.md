---
title: A todo app is the first app an agent builds
created: 2026-11-22
refs:
  - git://3f55e4349 - main when the facts were checked
  - "[briefs/plugins-are-a-sessions-extensions.md](plugins-are-a-sessions-extensions.md) - an agent builds an app that lasts, which this app is the first case of"
  - "[ideas/a-plugin-registers-a-thing-and-its-kinds.md](../ideas/a-plugin-registers-a-thing-and-its-kinds.md) - a generic thing with its kinds, which `todo` would be the first of"
  - "[briefs/a-person-acts-from-a-plugin-page.md](a-person-acts-from-a-plugin-page.md) - a plugin's page and its Buttons"
  - "[code://packages/sdk/src/types/records.ts](../../packages/sdk/src/types/records.ts) - `host.records(name)`, a plugin's own collections"
  - "[code://packages/sdk/src/types/tunnels.ts#L132-L190](../../packages/sdk/src/types/tunnels.ts#L132-L190) - `TunnelKind`, the one kind a plugin registers with a schema and operations"
  - "[code://packages/sdk/src/types/kinds.ts](../../packages/sdk/src/types/kinds.ts) - `KindOperation`, and `OperationScope`, a closed list"
  - "[code://packages/sdk/src/kinds/operations.ts#L10-L25](../../packages/sdk/src/kinds/operations.ts#L10-L25) - `x-ahpd/invokeOperation`, one command for every operation"
  - "[code://packages/sdk/src/resources/recordschannel.ts](../../packages/sdk/src/resources/recordschannel.ts) - a list of records as an `x-` channel, with owner filters"
  - "[code://packages/sdk/src/plugins/view.ts#L32](../../packages/sdk/src/plugins/view.ts#L32) - `VIEW_KINDS`, the twelve components a view may hold"
  - "[code://packages/sdk/src/plugins/view.ts#L297-L321](../../packages/sdk/src/plugins/view.ts#L297-L321) - a Button's `context` is a literal object"
  - "[code://packages/sdk/src/types/plugin.ts#L853](../../packages/sdk/src/types/plugin.ts#L853) - `ViewSurface`, only `main`"
  - "[code://packages/sdk/src/types/plugin.ts#L551-L575](../../packages/sdk/src/types/plugin.ts#L551-L575) - `PluginMethod`, which gets the caller and its owner"
  - "[code://packages/sdk/src/types/host.ts#L1422-L1582](../../packages/sdk/src/types/host.ts#L1422-L1582) - `HostTool`, with `isEnabledForSession` and `optIn`"
  - "[code://packages/sdk/src/plugins/enablement.ts](../../packages/sdk/src/plugins/enablement.ts) - on and off per scope, for plugins and MCP servers, not for tools"
  - "[code://packages/sdk/src/tools/artifacts.ts](../../packages/sdk/src/tools/artifacts.ts) - `add_artifact_or_reference`, a session's artifacts by URI"
  - "[briefs/artifact-integrations.md](artifact-integrations.md) - VS Code's artifact integrations, which give a reference its actions later"
  - git://github.com/microsoft/agent-host-protocol@1ef06429 - `types/channels-chat/state.ts#L970`, `MessageResourceAttachment`; `#L1089`, `ResourceResponsePart`; `types/common/commands.ts#L729`, `resourceRead`
  - git://github.com/microsoft/vscode@1564f100807a - `src/vs/platform/agentHost/ARTIFACT_INTEGRATIONS_PROPOSAL.md` §5.4, state-dependent and general actions
  - "[code://packages/sdk/src/host/resourcemethods.ts#L65-L74](../../packages/sdk/src/host/resourcemethods.ts#L65-L74) - `resourceRead` and `createResourceWatch` find a resource provider by the URI's scheme"
  - "[code://packages/sdk/src/host.ts#L1380-L1410](../../packages/sdk/src/host.ts#L1380-L1410) - a watch starts the provider's `watch`, and sends `resourceWatch/changed`"
  - "[code://packages/sdk/src/access/people.ts#L1-L12](../../packages/sdk/src/access/people.ts#L1-L12) - `user://<id>`, a record's scheme beside its `x-ahpd-users://` channel"
  - "[code://packages/bot/src/provider.ts#L159](../../packages/bot/src/provider.ts#L159) - the bot provider's `watch`, a plugin provider that has one"
  - file:///github/ahpd/.scratch/dsh-todo-app - dsh's todo app: React in the client, data in the browser
---

# A todo app is the first app an agent builds

Softov wants the first agent-built app to be a todo app, because it has all the parts: create, read, update, delete and storage. The app needs three parts: "a way to render", "its ui context", and "a way to accept actions and interact with those actions". All of it can go in 0.17. This brief writes the app as it would be, with its calls, so the missing parts show. The steps and the plans come from it.

## What others do

- **dsh** has `dsh-todo-app`. The host half is `export function apply() {}`. The client half is React code that dsh loads into its page, and the list is kept in the browser's storage. Nothing on the host can read or change a todo. Softov does not want client code injection for now.
- **VS Code** lets Copilot's agent write an agent extension that draws a canvas and gives the agent tools. The extension is a program Copilot CLI starts, not code in the window.

## What ahpd has today

- **Storage.** `host.records(name)` opens a collection of JSON records, each with a slug `id`. It has `get`, `list`, `find`, `put`, `remove` and `watch`. Records have no owner field of their own.
- **Kinds.** `registerTunnelKind` is the one call that registers a kind with a schema, operations and handlers. The host keeps the records, serves `create`, `update`, `remove`, `enable` and `disable`, and lists the kind's own operations. `OperationScope` is a closed list: `list`, `tunnel`, `client`, `agent` and `connector`. No call registers a kind of something else.
- **Actions.** `x-ahpd/invokeOperation` `{ channel, operationId, target?, input? }` runs one operation. The host checks the grant and the `input` against the operation's schema. A client draws the form from that schema.
- **Methods.** `registerMethod` serves an `x-` command. Its `handle` gets the params, the caller, its client id and its owner.
- **Channels.** `RecordsChannel` serves a list of records as an `x-` channel, with `added`, `changed` and `removed`, and reads by owner.
- **Views.** A plugin draws one view on its own page, the `main` surface, with `showView` and `setViewData`. Every reader sees the same view. The components are `Text`, `Link`, `Button`, `Card`, `Row`, `Column`, `List`, `Divider`, `Icon`, `Progress`, `DateTime` and `KeyValue`. None takes input. A Button's `context` is a literal, so a Button drawn once per row cannot send that row's id.
- **Tools.** `registerTool` gives every session a tool. `isEnabledForSession` and `optIn` let the tool itself decide per session. No switch turns a plugin's tools off while it runs, and no client switch turns one tool off for a session.

## The app

The app is a package `@local/todo`, in the plugin folder, with today's plugin shape. Each part below says whether it works today or is new.

### The package

Works today.

```json
{
  "name": "@local/todo",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "ahpd": { "title": "Todos", "description": "A shared todo list." }
}
```

### The record

A todo's own data is the fields of the kind's schema, and nothing else:

```json
{ "title": "Buy milk", "done": false }
```

In step 1, before the kind exists, the app keeps it with `host.records` and writes the owner itself, from the tool's caller:

```js
export async function apply(host) {
  const todos = host.records('todos', { format: 'json' });
  // { id: 't-buy-milk', title: 'Buy milk', done: false, owner: 'user:ana' }
}
```

With the kind, the host keeps the record, its kind and its owner, as *The row* says.

### The thing and its kind

New. A thing is one list on the host, and a kind is one type of record in it. Softov, 2026-11-23: "A thing and its kinds".

- No plugin owns a thing. Any plugin may declare it, and a declaration with the same name joins the thing. Softov, 2026-11-23: "Any plugin declares it, same name joins".
- Any plugin may add a kind to a thing, as two plugins add devtunnel and cloudflare to the tunnels, and computers take their runtimes.
- The first declaration loaded gives the thing's title and description. A declaration that differs is a warning on its plugin's row.
- The thing lives while a plugin declares it or holds a kind of it. A plugin that unloads takes its kinds, and the thing keeps the others.
- The grants are the thing's, as the tunnels' are: `<name>:get` to read, `<name>:put` to create, change and run an operation, and `<name>:delete` to remove. An operation may name its own grant, as `KindOperation.grant` does today. A record operation's scope is the thing's name (defaulted).
- The channel and the row scheme are the thing's, not a plugin's: `x-ahpd-<plural>://` lists the rows, and `<name>://<id>` is one row. Softov, 2026-11-23: "x-ahpd-<plural>://, <name>://<id>". This is the form of `x-ahpd-users://` and `user://<id>`, and of `x-ahpd-tunnels://`.
- A declaration may name the plural. Without one, the host adds an `s` to the name (defaulted). [a-crm-is-the-second-example-kind.md](a-crm-is-the-second-example-kind.md) checks this against a thing with many kinds.

The todo app registers the thing `todo`, and one kind in it, also named `todo`:

```js
host.registerThing({ name: 'todo', plural: 'todos', title: 'Todos', description: 'A shared todo list.' });
```

The kind has the shape of `TunnelKind`. The kind declares its `schema` once. The host keeps the list, serves create, update and remove with that schema as their form, and lists the records on a channel. A client draws the forms with no code for todos.

```js
host.registerKind({
  thing: 'todo',
  name: 'todo',
  title: 'Todo',
  description: 'One thing to do.',
  schema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title', maxLength: 500 },
      done: { type: 'boolean', title: 'Done', default: false },
    },
  },
  operations: [
    { id: 'complete', label: 'Done', icon: 'check', offered: (todo) => !todo.done },
    { id: 'reopen', label: 'Not done', icon: 'undo', offered: (todo) => todo.done },
    { id: 'clear', label: 'Clear completed', scopes: ['list'], confirmation: 'Remove every done todo?' },
  ],
  async invoke(name, row, report) {
    if (name === 'complete') return report({ record: { ...row.record, done: true } });
    if (name === 'reopen') return report({ record: { ...row.record, done: false } });
    // clear: remove each done todo
  },
});
```

### How a client finds the kind

The handshake lists each channel in `ahpd.channels`. Each entry gets `kinds`, one entry per kind the channel holds, keyed by the kind's name. Softov, 2026-11-22: "inside the channel as kinds: {}".

- A channel can hold more than one kind, as `x-ahpd-tunnels://` holds devtunnel and cloudflare from two plugins. So a kind is never listed apart from its channel.
- Each kind lists every operation in full: the ones the host makes, `<kind>/create`, `<kind>/update` and `<kind>/remove`, and the kind's own, `<kind>/<id>`. A client needs no rule for which operations every kind has.
- The entry changes when a plugin loads or unloads, through the root state, as `ahpd.channels` does today.

```json
"ahpd.channels": [
  { "scheme": "x-ahpd-todos", "title": "Todos", "grant": "todo:read",
    "kinds": {
      "todo": {
        "title": "Todo",
        "description": "One thing to do.",
        "schema": { "type": "object", "required": ["title"], "properties": {
          "title": { "type": "string", "title": "Title", "maxLength": 500 },
          "done": { "type": "boolean", "title": "Done", "default": false } } },
        "operations": [
          { "id": "todo/create", "label": "Todo", "scopes": ["list"], "grant": "todo:put", "input": "the kind's schema" },
          { "id": "todo/update", "label": "Edit", "scopes": ["todo"], "grant": "todo:put", "input": "the kind's schema" },
          { "id": "todo/remove", "label": "Remove", "confirmation": "Remove this todo?", "scopes": ["todo"], "grant": "todo:delete" },
          { "id": "todo/complete", "label": "Done", "icon": "check", "scopes": ["todo"], "grant": "todo:put" },
          { "id": "todo/reopen", "label": "Not done", "icon": "undo", "scopes": ["todo"], "grant": "todo:put" },
          { "id": "todo/clear", "label": "Clear completed", "confirmation": "Remove every done todo?", "scopes": ["list"], "grant": "todo:put" }
        ]
      }
    } }
]
```

`"input": "the kind's schema"` stands for the schema itself, which the host copies into the operation. The grants `todo:read`, `todo:put` and `todo:delete`, and the scope `todo`, are examples: *Open points* has them.

### The row

A row keeps the kind's data apart from what the host knows. Softov, 2026-11-22: "separate shape".

```json
{ "id": "t-buy-milk", "kind": "todo", "owner": "user:ana",
  "record": { "title": "Buy milk", "done": false },
  "operations": ["todo/update", "todo/remove", "todo/complete"],
  "operation": { "id": "todo/complete", "status": "running" } }
```

`operation` is how a reader of one row sees a call that another person started. The caller does not need it: `x-ahpd/invokeOperation` answers when the operation ends. A kind whose operations take minutes, such as a deploy, needs it most. Softov, 2026-11-22: "status on the row plus a watch".

| Field | Holds | Kept by |
| --- | --- | --- |
| `id` | The row's slug | The host |
| `kind` | The kind whose `schema` the record follows, an entry of `ahpd.channels` | The host |
| `owner` | Who made the row: `user:<id>`, a team or the host | The host, for every kind |
| `record` | The fields of the kind's schema, and only those. The update form edits this object | The kind |
| `operations` | The operation ids the row offers now, from each operation's `offered` | The host |
| `operation` | The operation running on the row now, or the last one that ran: `{ id, status, error? }`, held in memory | The host |

Tunnel rows hold the kind and the host's facts inside the record today. They move to this shape later, in a change of their own after the todo app. Softov, 2026-11-22: "tunnels move too, but after in a future".

### The channel

A page that shows the whole list subscribes to the kind's channel:

```json
{ "jsonrpc": "2.0", "id": 6, "method": "subscribe", "params": { "channel": "x-ahpd-todos://" } }
```

The snapshot's state holds the rows, and the status of each operation that a call runs now. The declarations stay in `ahpd.channels`.

```json
{
  "records": [
    { "id": "t-buy-milk", "kind": "todo", "owner": "user:ana",
      "record": { "title": "Buy milk", "done": false },
      "operations": ["todo/update", "todo/remove", "todo/complete"] },
    { "id": "t-call-bob", "kind": "todo", "owner": "user:ana",
      "record": { "title": "Call Bob", "done": true },
      "operations": ["todo/update", "todo/remove", "todo/reopen"] }
  ],
  "operations": [
    { "id": "todo/clear", "status": "idle" }
  ]
}
```

A client draws this with no code for todos:

- A list operation, such as `todo/create` and `todo/clear`, is a button on the list. A record operation is a button on each row that names it in `operations`.
- An operation with `input` opens a form drawn from the schema: a text field for `title` and a check box for `done`.
- An operation with `confirmation` asks it before it runs.
- `status` is `running` while a call runs, and `error` with its message when the call failed. Each subscriber gets the change as `x-ahpd-todos/operations`.

A person adds a todo from a client:

```json
{ "jsonrpc": "2.0", "id": 7, "method": "x-ahpd/invokeOperation",
  "params": { "channel": "x-ahpd-todos://", "operationId": "todo/create", "input": { "title": "Buy milk" } } }
```

and marks it done:

```json
{ "jsonrpc": "2.0", "id": 8, "method": "x-ahpd/invokeOperation",
  "params": { "channel": "x-ahpd-todos://", "operationId": "todo/complete", "target": { "id": "t-buy-milk" } } }
```

Every reader of the channel then gets:

```json
{ "jsonrpc": "2.0", "method": "action", "params": { "channel": "x-ahpd-todos://", "serverSeq": 42,
  "action": { "type": "x-ahpd-todos/changed", "id": "t-buy-milk", "kind": "todo", "owner": "user:ana",
    "record": { "title": "Buy milk", "done": true },
    "operations": ["todo/update", "todo/remove", "todo/reopen"] } } }
```

### A reference in a chat

A chat points at one row by the row's URI. Softov, 2026-11-22: "plain row URI now, artifact integration later".

The URI is a resource scheme beside the channel, as the users directory serves `user://<id>` beside `x-ahpd-users://`. For the todo kind that is `todo://t-buy-milk`. A channel URI cannot be the row's URI: `resourceRead` and `createResourceWatch` go to a resource provider by its scheme, and a channel is not one.

The reference is AHP's own. A message carries it as a `resource` attachment, and an answer as a `contentRef` part, each a `ContentRef` with the `uri`:

```json
{ "type": "resource", "uri": "todo://t-buy-milk", "contentType": "application/json" }
```

A client reads the one row with `resourceRead`, with no subscribe to the list:

```json
{ "jsonrpc": "2.0", "id": 9, "method": "resourceRead", "params": { "uri": "todo://t-buy-milk" } }
```

The answer is the row of *The row*, as JSON:

```json
{ "jsonrpc": "2.0", "id": 9, "result": { "encoding": "utf-8", "contentType": "application/json",
  "data": "{\"id\":\"t-buy-milk\",\"kind\":\"todo\",\"owner\":\"user:ana\",\"record\":{\"title\":\"Buy milk\",\"done\":false},\"operations\":[\"todo/update\",\"todo/remove\",\"todo/complete\"]}" } }
```

A reader who keeps the reference on screen watches the row, with AHP's `createResourceWatch`, and subscribes to the channel it answers:

```json
{ "jsonrpc": "2.0", "id": 10, "method": "createResourceWatch", "params": { "uri": "todo://t-buy-milk" } }
```

Each change to the row, its record or its running operation, arrives as `resourceWatch/changed` on that watch, and the reader reads the row again:

```json
{ "jsonrpc": "2.0", "method": "action", "params": { "channel": "<the watch's channel>", "serverSeq": 3,
  "action": { "type": "resourceWatch/changed", "changes": { "items": [ { "uri": "todo://t-buy-milk", "type": "updated" } ] } } } }
```

The host serves the row's scheme for every kind, with `read` and `watch`, as the bot plugin's provider serves `bot://`. A provider with no `watch` cannot be watched today: `createResourceWatch` refuses it.

- The client finds the kind `todo` in `ahpd.channels`, and draws a button for each id in `operations`, with the kind's label and form.
- A click sends `x-ahpd/invokeOperation` with the channel and `target: { id }`, as *The channel* shows.
- The host checks the reader's grant on the row before it answers, as it does for the list.
- An agent records the reference in its session with `add_artifact_or_reference`, type `resource`, and this `uri`.

What VS Code does with a recorded `resource`, seen on 2026-11-23 with `artifactTools` and `chat.artifactIntegrations.enabled` on:

- It lists the entry as a row in the Artifacts or References pill, by `isArtifact`, with its `label`, a link icon and Copy URI.
- It never reads the row. A click hands the URI to VS Code's opener, which answers "Unable to resolve resource todo://t-buy-milk", because nothing in VS Code serves the scheme.
- ahpw draws the reference from the row, as the list items of this section say. VS Code draws only the label.

An artifact integration gives a recorded entry live state and actions. VS Code draws what the integration sends: an icon, a label, sections, and state-dependent and general actions. It is made for what a session produced and follows, such as a pull request it opened. Whether a kind's row is one is open.

A kind and an artifact integration do two jobs:

| | A kind | An artifact integration |
| --- | --- | --- |
| What it is | The host's list of records, with create, read, update and remove | A live view of one thing a session points at |
| Scope | The whole host, every session | One recorded entry in one session |
| Makes things | Yes, `todo/create` | No, it follows what a session recorded |
| Automation | None | Yes, per session, with consent |

They work together. A kind holds the todos. A session can record a todo it works on. An integration then shows that todo's state on the session's pill, and offers Done. It can also offer automation, such as "mark it done when the pull request merges".

An agent then acts on a todo in two ways:

| Way | Reaches | Needs | Gives |
| --- | --- | --- | --- |
| The app's tools, such as `todo_update` | Any todo, from any session | Nothing more | The change |
| The integration's tools, `get_artifact_status` and `run_artifact_action` | One todo the session recorded | `add_artifact_or_reference` with the row's URI, and an integration that claims the URI's scheme | The todo's state and actions on the session's pill, and automation |

The flow of the second way:

1. The agent calls `todo_add`, and gets the id, so the URI is `todo://t-buy-milk`.
2. The agent records the URI with `add_artifact_or_reference`, type `resource`.
3. An integration that claims `todo://` matches the entry. VS Code matches by URI, and the entry's type is "a hint, not proof".
4. `get_artifact_status` answers the todo's state, and its actions from the operations the row offers now.
5. `run_artifact_action` runs one of them, such as `todo/complete`, through the kind, as `x-ahpd/invokeOperation` does.
6. A person sees the same actions as buttons on the pill in VS Code.

`run_artifact_action` runs only `code` actions, and a kind's operations are code. A `prompt` action is refused there, because the agent does that work in its own chat.

### The tools

Works today, with `registerTool`. An agent in any session reads and changes the same list.

A kind's operations become tools when the app opts in. An app that opts out writes its own tools, as this section does. Softov, 2026-11-23: "it could be optin by the app", and "configurable is the better option".

```js
host.registerTool({
  definition: {
    name: 'todo_add',
    description: 'Add a todo to the shared list.',
    inputSchema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } },
  },
  async run({ title }, at) {
    const id = slugOf(title);
    await todos.put({ id, title, done: false, owner: at.person(), createdAt: new Date().toISOString() });
    return `Added ${id}.`;
  },
});
```

The four tools are `todo_list`, `todo_add`, `todo_update` (title or done) and `todo_remove`. An agent calls one as it calls any host tool:

```json
{ "name": "todo_add", "input": { "title": "Buy milk" } }
```

and gets `Added t-buy-milk.`.

### The page

Partly today. The app draws its list on its plugin page, and keeps the data model current when a record changes.

```js
host.showView({
  root: 'page',
  components: {
    page: { id: 'page', component: 'Column', children: ['head', 'items'] },
    head: { id: 'head', component: 'Text', text: { path: '/summary' } },
    items: { id: 'items', component: 'List', children: { path: '/todos', componentId: 'row' } },
    row: { id: 'row', component: 'Row', children: ['title', 'done'] },
    title: { id: 'title', component: 'Text', text: { path: 'title' } },
    done: { id: 'done', component: 'Button', label: 'Done',
            action: { event: { name: 'x-todo/complete', context: { id: { path: 'id' } } } } },
  },
  dataModel: { summary: '1 of 3 done', todos: [{ id: 't-buy-milk', title: 'Buy milk', done: false }] },
});

todos.watch(async () => host.setViewData('/todos', await todos.list()));
```

Three things in it do not work today:

- `context: { id: { path: 'id' } }` is refused, because a Button's `context` is a literal. The row's Button cannot say which todo it is.
- The page has no text field, so a person cannot type a new todo on it. The kind's `create` form gives one in the client's own list of the kind instead.
- Every reader sees the same view, so a person's own todos cannot be drawn for that person only.

## What is missing

Each row is one of Softov's three parts. "Kind" is the generic registration that the idea `a-plugin-registers-a-thing-and-its-kinds` names.

| Part | Missing | Without it |
| --- | --- | --- |
| Render | A way to register a thing and its kinds: `registerThing`, `registerKind`, a channel per thing, and an open `OperationScope` | Each new thing needs new host code |
| Render | A kind's schema and operations in its channel's entry of `ahpd.channels` | A client learns the operations only by subscribing to the list |
| Render | One row shape, with the kind's data apart from the host's facts | A field of a record can clash with one of the host's |
| Render | Input components in a view, such as a text field and a check box | A person types only in the kind's form |
| UI context | A view that knows its reader: per person, and per session where the page opens in one | Every reader sees one list |
| Actions | A Button `context` that reads `{ path }` inside a repeated row | One Button per row cannot name its row |
| Actions | Tools that a kind's operations give when the app opts in | The app writes four tools by hand |
| Tools | "Tools only" off for the host, from the plugins brief | A person turns the whole app off to stop its tools |

## Steps

A first order, for the plans:

1. Write the app with what works today: records, four tools, and a page that only reads. It proves the storage and the tools, and it is the example an agent copies.
2. A plugin registers a thing and its kinds, with the thing's channel, its operations and its entry in `ahpd.channels`. Rows take the shape of *The row*, and a row's URI reads alone. The todo list moves from the page to the kind. Add the four parts of the CRM brief's *Answers*.
3. A view's Button reads `{ path }` in its `context`, and a view gets input components.
4. A view knows its reader.
5. A plugin's tools turn off while it runs.
6. The app runs on the stdio runtime.
7. Later, artifact integrations, and whether a kind's row is one, as *A reference in a chat* says.
8. Later, tunnels move to the row shape of *The row*.

## Open points

- How a view is shown, which Softov thinks over himself. Softov, 2026-11-23: "a ui its like a view that can be show. just that". A view says where it opens by default, such as `main` or the explorer. This covers the input components and the schema of each UI kind.
- How VS Code opens a row's URI, which it cannot resolve today.
- Whether a kind's row is an artifact integration, or integrations stay for what a session produced.
- Where a page opens with a session as its context: a plugin page, or a canvas in a chat.
