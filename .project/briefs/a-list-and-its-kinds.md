---
title: A list and its kinds
created: 2026-11-25
refs:
  - git://8d554d00f - main when the facts were checked, with #479
  - file:///github/ahp-review/briefs/lists-and-kinds/ - where this brief was drafted, with Softov, on 2026-11-25
  - file:///github/ahp-review/briefs/resource-kinds/ - the earlier try this brief takes instances, relations, rows kept outside ahpd and runtime rows from
  - "[briefs/a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) - the list no plugin owns, and `registerList`"
  - "[briefs/a-crm-is-the-second-example-kind.md](a-crm-is-the-second-example-kind.md) - kinds from several plugins in one list"
  - "[briefs/the-host-keeps-a-machines-services.md](the-host-keeps-a-machines-services.md) - beorn's services and deploy, the second example"
  - "[code://packages/sdk/src/types/tunnels.ts#L132-L201](../../packages/sdk/src/types/tunnels.ts#L132-L201) - `TunnelKind`, the one kind a plugin registers today"
  - "[code://packages/sdk/src/kinds/operations.ts](../../packages/sdk/src/kinds/operations.ts) - `x-ahpd/invokeOperation`, which runs a kind's operations"
---

# A list and its kinds

A plugin declares a list that the host serves and no plugin owns, and any plugin adds kinds of record to it. A client draws the list, its filters, its rows, their forms and their buttons from what the host sends, with no code for the list. This is how tunnels work in ahpd today, made generic.

It takes from two earlier tries, and replaces neither yet:

| Try | Kept | Not kept |
| --- | --- | --- |
| The todo and CRM briefs (`registerList`, #479) | A list no plugin owns, which a declaration with the same name joins. A channel named after the list, such as `x-ahpd-tickets://`. | Nothing says where a row comes from, how a list is filtered, sorted or paged, how rows relate, or how they are drawn. |
| `resource-kinds`, in ahp-review | Instances, relations, rows kept outside ahpd, runtime rows, paging. Its views wait, as *Views come later* says. | `x-ahpd-kind://<kind>`, and one kind as one list from one plugin. |

It is defined in two steps: `registerList`, then `registerKind` for each kind in it. Three examples follow one case each:

- *Example: brbyte Desk tickets from several connectors*: rows kept in another system, with several connectors.
- *Example: a machine's services*: rows that are processes, on a machine.
- *Example: a CRM with kinds from several plugins*: several plugins in one list, and links between lists.

## Step 1: `registerList`

The list is what every row in it shares, whatever its kind.

```ts
host.registerList({
  name: 'ticket',
  channel: 'x-ahpd-tickets',
  title: 'Tickets',
  description: 'Requests people make for help.',
  icon: 'issues',
  instances: true,
  filters: [
    { field: 'status', type: 'enum' },
    { field: 'createdAt', type: 'range' },
    { field: 'client', type: 'uri', channel: 'x-ahpd-clients' },
  ],
  search: ['title'],
  sorts: ['createdAt', 'updatedAt', 'status'],
  defaultSort: '-updatedAt',
  page: { size: 50 },
});
```

| Part | What it is |
| --- | --- |
| `name` | The scheme of one row, and the subject of the list's grants. |
| `instances` | Whether a row's URI carries an instance. With it, a row is `<name>://<instance>/<id>`. Without it, a row is `<name>://<id>`, and a kind that adds an instance is refused. Every kind in the list follows the list, and a declaration with another `instances` is a warning on its plugin's row. |
| `channel` | The list's channel scheme, such as `x-ahpd-tickets`, so the list is `x-ahpd-tickets://`. Required. Any plugin may name an `x-ahpd-*` scheme. A declaration with the same `name` and another `channel` is a warning on its plugin's row, and a list on a scheme a `registerChannel` already took, or the other way round, is refused. |
| `title`, `description`, `icon` | What a client shows for the list. The first declaration loaded gives them, and one that differs is a warning on its plugin's row. |
| `filters` | An array of filters, in the order a client draws them. A filter is `{ field, type }`, and the field is its name in a query. A filter type is `enum`, `range`, `uri` or `boolean`. A `uri` filter also names the `channel` its picker lists. The schema is not changed. |
| `search` | The fields a free-text search reads, as `?search=`. |
| `sorts`, `defaultSort` | The fields a client may sort by, and the order with none asked. `-` is descending. |
| `page` | The page size. A page answers one cursor for the next, which the client sends back as it got it. A list with no `page` sends every row on subscribe, as a records channel does today. |

The grants are the list's: `<name>:get`, `<name>:put` and `<name>:delete`, as the tunnels' are. An operation may name its own grant.

A client asks for part of a list on the channel URI, with the filters and sorts the list declares:

```text
x-ahpd-tickets://?status=1,2&client=client://desk-production/5120&sort=-createdAt
```

The host refuses a filter or a sort the list does not declare.

A kind takes part in a filter when its field has the filter's type, read from the kind's schema:

| Filter type | A field that matches |
| --- | --- |
| `enum` | has `enum` |
| `range` | is a `number` or an `integer`, or a `string` with `format: date-time` |
| `uri` | is a `string` with `format: uri`, and the kind's relation for it names the filter's `channel` |
| `boolean` | is a `boolean` |

One page merges the rows of every kind and every instance. The cursor is the host's: it holds where each kind and each instance stopped, and a client reads nothing in it.

## Step 2: `registerKind`

A kind is one type of record in a list, from any plugin.

```ts
const tickets = host.registerKind({
  channel: 'x-ahpd-tickets',
  name: 'desk-ticket',
  title: 'Desk ticket',
  class: 'data',
  schema,
  operations,
  relations: {
    client:       { channel: 'x-ahpd-clients', one: 'client' },
    interactions: { channel: 'x-ahpd-interactions', many: 'ticket' },
  },
  rows: { list: (query, instance, reader) => ..., read: (id, instance, reader) => ... },
  invoke: (operation, row, report, input) => ...,
});
tickets.addInstance({ id: 'desk-production', title: 'Desk' });
tickets.changed('desk-production', '18432');
```

| Part | What it is |
| --- | --- |
| `channel` | The channel of the list it joins, such as `x-ahpd-tickets`. |
| `name`, `title`, `description`, `icon` | Its name, unique in the list, and what a client shows for it. An operation id is `<kind>/<operation>`, as `devtunnel/create` is today. |
| `class` | `data`: a record a person reads and changes. `runtime`: a process with a state, as a tunnel is. The host calls its `start` and `stop` hooks, as it calls a tunnel kind's. |
| `schema` | The fields a row has, as JSON Schema with AHP's `enumLabels`. Filters and sorts name these fields and do not change them. |
| `operations` | The kind's own verbs, as `KindOperation` is today, run by `x-ahpd/invokeOperation`. An operation with `long: true` answers with a run, and a client knows before it invokes it. |
| `invoke` | Runs one of the kind's operations on a row, as a tunnel kind's `invoke` does. |
| `rows` | Where the kind's rows are: `list` answers one page for one instance, filtered and sorted, and `read` answers one row. |
| `relations` | Which fields hold the URI of a row of another list, one or many. The key is the field on this row. The value after `one` or `many` is the field on the other list that points back: `many: 'ticket'` is the `ticket` field of each interaction. A form draws a picker from that list. |
| instances | Where a row comes from: a connector, a machine, an account. `addInstance` and `removeInstance` change them at run time, and the list's subscribers are told. |
| `changed` | On the handle: `changed(instance, id)` says a row changed, such as after an operation, or when a webhook or a poll heard of a change outside ahpd, and the host reads it again and tells the list's subscribers. |

Who keeps the rows follows who controls the list. The host keeps the rows of the channels it controls, such as `x-ahpd-tunnels://`, and a tunnel kind keeps none. The rows of a list a plugin registers are its kinds' to keep and answer, through `rows`: the host keeps the list's structure, its declaration and its kinds, and no row.

A list filter names a field. A kind that lacks the field, or has it with another type, takes no part in that filter. Its rows are left out while the filter is set. A sort works the same way: a kind that cannot sort by the field asked has its rows left out while that sort is set.

## What the host does

- It serves the list's `channel` with the rows of every kind and every instance, filtered, sorted and paged as the list declares.
- It asks each kind's `rows` for each page and each read, and keeps no copy.
- It serves create, update and remove with the kind's schema as their form, and hands each to the kind's `invoke`.
- It serves one row at `<name>://<instance>/<id>`, or `<name>://<id>` in a list with no `instances`, read with `resourceRead`.
- For a `runtime` kind, it calls `start` and `stop` as it does for a tunnel kind.
- It lists the list in `ahpd.channels`, with `kinds`, one entry per kind, as [a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) says.

## Who writes

- **No open branch of `ahpio/ahpd`** changes tunnels, `invokeOperation` or the records channel. Nothing here is built.
- **beorn's fork** serves services and deploy on their own channels, `x-hh-services://` and `x-hh-deploys://`. *Example: a machine's services* is what they would become.
- **Tunnels** move onto `registerList` and `registerKind` once runtime kinds exist, not before.
- **ahpw** draws tunnels, agents and connectors with code for each. A list drawn from this shape needs none.
- **The todo and CRM briefs** keep their app and their CRM. Where they say how a list is declared, filtered or named, this brief replaces them.

## Views come later

How a client draws a list, as a table, a board or a calendar, waits until the list and the kind are settled. So does how it draws one row. A view only names fields, filters and relations, so it adds to this shape and changes none of it. Until then, a client draws a plain list and a plain form from the schema.

## What Softov chose while drafting

| What | Source |
| --- | --- |
| Neither the todo and CRM briefs nor `resource-kinds` is enough alone; this brief takes from both | Softov, 2026-11-25: "neither one is right in my point of view" |
| A list's channel is named after the list, not `x-ahpd-kind://customer` | Softov, 2026-11-25: "`x-ahpd-customer://`" |
| The declaration names its channel as a whole scheme, `channel: 'x-ahpd-tickets'`, in place of `plural` | Softov, 2026-11-25: "channel: 'x-ahpd-tickets'" |
| Filters and sorts are their own keys on the list, and do not change a kind's schema | Softov, 2026-11-25: "filters and sorts separated. so it does not affect the schema definition" |
| `registerList` first, then `registerKind` | Softov, 2026-11-25: "registerList and registerKind" |
| Filters are an array | Softov, 2026-11-25: "and not a array?" |
| Views wait until the list and the kind are settled | Softov, 2026-11-25: "maybe view can be done one next steps. when structure is well defined?" |
| A filter is `{ field, type }`, and free text is `search` | (defaulted: no `id` to repeat the field) |
| A kind joins a list by its channel, `channel: 'x-ahpd-tickets'` | Softov, 2026-11-25: "list: 'ticket' instead channel", and asked again, chose `channel` |
| The instance in a row's URI is optional: a kind with no instances uses `<name>://<id>` | Softov, 2026-11-25: "the instance onto uri or not should be optional" |
| The list says with `instances` whether its URIs carry an instance, and every kind in it follows. | Softov, 2026-11-25, chose "Per list" (in one list with both forms, `issue://a/b` could be instance `a` and id `b`, or id `a/b`) |
| The host merges one page from every kind and every instance | Softov, 2026-11-25: "Merge then" |
| A plugin may add operations to the kinds of a list it did not register, as deploy does to services | Softov, 2026-11-25: "a way to register operations onto kinds? its interesting to have something like that" |
| A connector that cannot be reached: its rows are left out, and the alert goes on the connector | Softov, 2026-11-25: "rows out, alert onto the connector" |
| A filter on a field a kind lacks leaves that kind's rows out | Softov, 2026-11-25: "Left out" |
| A quick operation keeps the row's status. An operation that says it is long answers with a run: its own channel with a lifecycle, progress, a log and cancel, as an automation run | Softov, 2026-11-25: "Run when long" |
| A reader sees the rows of the instances they may use, by the connector's owner rule. A kind with no instance falls back to the channel's grant | Softov, 2026-11-25: "The instance's owner" |
| Two declarations of one list join their filters | Softov, 2026-11-25: "Joined" |
| A plugin registers an operation onto kinds it names, and it reaches every record of those kinds. Its `offered(record)` may narrow it to some records | Softov, 2026-11-25: "a way to register operations onto kinds", and "all records of that kind" |
| "Kind" keeps its meaning in `Operation.kind`, and an operation id stays `<kind>/<operation>` | Softov, 2026-11-25: "Drop it" |
| The list of a machine's programs is `services` | Softov, 2026-11-25: "services" |
| A service's deploy declaration is written under its own grant, which no default role holds | Softov, 2026-11-25: "Its own grant" |
| Any plugin may name an `x-ahpd-*` scheme | Softov, 2026-11-25, chose "Any plugin" |
| A `registerChannel` and a `registerList` on the same scheme: the second is refused | Softov, 2026-11-25, chose "Refused" |
| `class: 'runtime'` gets `start` and `stop` hooks from the host | Softov, 2026-11-25, chose "Runtime gets hooks" |
| A kind says a row changed with `changed(instance, id)` on its handle | Softov, 2026-11-25, chose "Handle method" |
| A merged page answers one cursor, which only the host reads | Softov, 2026-11-25, chose "One opaque cursor" |
| A kind that cannot sort by the field asked has its rows left out, as for a filter | Softov, 2026-11-25, chose "Left out" |
| A field takes part in a filter by a fixed mapping from its schema type to the filter's type | Softov, 2026-11-25, chose "Fixed mapping" |
| In a relation, the value after `one` or `many` is the field on the other list that points back | Softov, 2026-11-25, chose "Field on the other side" |
| A long operation says so with `long: true` on its declaration | Softov, 2026-11-25, chose "long: true on it" |
| A `uri` filter keeps its `channel`, and a kind whose relation names another channel takes no part in it | Softov, 2026-11-25, chose "Keep both" |
| Tunnels move onto lists after runtime kinds exist | Softov, 2026-11-25, chose "After runtime kinds" |
| The host hands create, update and remove on a plugin's list to the kind's `invoke`, after checking the input against the kind's schema | Softov, 2026-11-25, chose "Through invoke" |
| Who keeps the rows follows who controls the list: the host for its own channels, such as tunnels, and the kinds for a list a plugin registers. `registerKind` has no `source` | Softov, 2026-11-25: "the host keep the rows for the channels it control. like tunnels", and "Imagine 1M tickets and the host keeping it" |

## Example: brbyte Desk tickets from several connectors

The `desk` plugin shows the tickets of brbyte Desk. A person adds one connector per Desk instance, such as production and staging, and sees the tickets of every instance in one list. The rows stay in Desk: ahpd keeps no copy. This is the case for instances and for rows kept outside ahpd.

The record's fields are Desk's, as `resource-kinds/example-01/desk-tickets.md` in ahp-review has them.

### The list

The `desk` plugin declares the list, so it works with no other plugin. A GitHub plugin could declare `ticket` too and add its own kind.

```ts
host.registerList({
  name: 'ticket', channel: 'x-ahpd-tickets', title: 'Tickets', instances: true,
  filters: [
    { field: 'status', type: 'enum' },
    { field: 'client', type: 'uri', channel: 'x-ahpd-clients' },
    { field: 'consultant', type: 'uri', channel: 'x-ahpd-clients' },
    { field: 'createdAt', type: 'range' },
    { field: 'updatedAt', type: 'range' },
  ],
  search: ['title', 'clientName'],
  sorts: ['updatedAt', 'createdAt', 'status'],
  defaultSort: '-updatedAt',
  page: { size: 50 },
});
```

### The kind, and its instances

The plugin registers the kind when it loads, with no instance. Each Desk connector that is enabled becomes an instance, and one that is disabled or removed stops being one.

```ts
const tickets = host.registerKind({
  channel: 'x-ahpd-tickets', name: 'desk-ticket', title: 'Desk ticket',
  class: 'data',
  schema: deskTicketSchema,               // every field readOnly: a ticket changes by an operation only
  operations: [answer, setStatus, assign],
  relations: {
    client:       { channel: 'x-ahpd-clients', one: 'client' },
    consultant:   { channel: 'x-ahpd-clients', one: 'consultant' },
    interactions: { channel: 'x-ahpd-interactions', many: 'ticket' },
  },
  rows: {
    list: (query, instance, reader) => desk(instance).tickets(query),   // one page, filtered and sorted by Desk
    read: (id, instance, reader) => desk(instance).ticket(id),
  },
  invoke: (operation, row, report, input) => desk(row.instance).run(operation, row.id, input),
});

host.onConnector('desk', {
  enabled:  (connector) => tickets.addInstance({ id: connector.id, title: connector.title }),
  disabled: (connector) => tickets.removeInstance(connector.id),
});
```

`host.onConnector` does not exist in ahpd today. It stands for any way a plugin hears that a connector of its adapter came or went.

### How the instance is correlated

The instance is the connector's id, and it is in every place a row is named:

| Where | Value |
| --- | --- |
| A row's URI | `ticket://desk-production/18432` |
| A row in the channel | `{ "id": "18432", "instance": "desk-production", "kind": "desk-ticket", "record": { ... } }` |
| A related row | `"client": "client://desk-production/5120"` |
| A query for one instance | `x-ahpd-tickets://?instance=desk-production` |
| A run of an operation | the host hands `invoke` the row, and `row.instance` names the connector to call |

Two instances can hold a ticket with the same Desk number, and their URIs still differ.

A related row names its own instance. A ticket of `desk-production` names a client of `desk-production`, so a client picker in its forms lists that instance's clients.

### One row

```jsonc
{
  "id": "18432",
  "instance": "desk-production",
  "kind": "desk-ticket",
  "record": {
    "title": "Ramal não registra depois da atualização",
    "status": 1,
    "client": "client://desk-production/5120",
    "clientName": "Padaria Central",
    "consultant": "client://desk-production/77",
    "consultantName": "Ana Souza",
    "createdAt": "2026-11-12T13:02:00Z",
    "updatedAt": "2026-11-13T10:41:00Z"
  },
  "operations": ["desk-ticket/answer", "desk-ticket/set-status", "desk-ticket/assign"]
}
```

A closed ticket lists no `answer`.

### What this example needs from the shape

- **Instances at run time.** A connector added later is a new instance, and the list's subscribers are told.
- **Rows the host does not keep.** Every page and every read is a request to Desk. The host has no event when someone answers in Desk's own screen. So a row changes on the channel only when it changed through ahpd, unless the plugin polls.
- **Filters and sorts that Desk serves.** The kind turns the list's query into Desk's own.
- **Relations across lists of the same plugin.** `clients` and `interactions` are lists the `desk` plugin also declares.

## Example: a machine's services

A person sees the programs a machine runs, starts, stops and restarts them, and deploys a new version of one. The rows are processes with a state that nobody stores. This is the case for runtime rows, instances per machine, and a long operation.

beorn proposed it on #474, from their `services` and `deploy` plugins for process-compose. [the-host-keeps-a-machines-services.md](the-host-keeps-a-machines-services.md) has what they built.

### The list

```ts
host.registerList({
  name: 'service', channel: 'x-ahpd-services', title: 'Services', instances: true,
  description: 'The programs this machine runs.',
  filters: [
    { field: 'status', type: 'enum' },
  ],
  search: ['name', 'command'],
  sorts: ['name', 'status'],
  defaultSort: 'name',
});
```

No `page`: a machine runs tens of services, and the list sends every row.

### Two kinds

process-compose and systemd are two kinds from two plugins. Each has its own form for a new service, and both rows share the fields the list filters on.

```ts
// in the process-compose plugin
const compose = host.registerKind({
  channel: 'x-ahpd-services', name: 'process-compose', title: 'process-compose',
  class: 'runtime',
  rows: processCompose.rows,
  schema: {
    type: 'object', required: ['name', 'command'],
    properties: {
      name:    { type: 'string', title: 'Name' },
      command: { type: 'string', title: 'Command' },
      restart: { type: 'string', title: 'Restart', enum: ['always', 'on_failure', 'no'] },
      status:  { type: 'string', title: 'Status', readOnly: true, 'x-ahpd-live': true,
                 enum: ['stopped', 'starting', 'running', 'failed'],
                 enumLabels: ['Stopped', 'Starting', 'Running', 'Failed'] },
      url:     { type: ['string', 'null'], format: 'uri', title: 'Address', readOnly: true, 'x-ahpd-live': true },
    },
  },
  operations: [
    { id: 'start', label: 'Start', icon: 'play', offered: (s) => s.status !== 'running' },
    { id: 'stop', label: 'Stop', icon: 'debug-stop', offered: (s) => s.status === 'running' },
    { id: 'restart', label: 'Restart', icon: 'debug-restart', offered: (s) => s.status === 'running' },
  ],
  start: (row, report) => processCompose.up(row, report),
  stop: (row) => processCompose.down(row),
  invoke: (operation, row, report) => processCompose.control(row, operation),
});
compose.addInstance({ id: hostname(), title: hostname() });

// in a systemd plugin: the same list, another kind and another form
host.registerKind({ channel: 'x-ahpd-services', name: 'systemd', title: 'systemd unit', class: 'runtime', schema: unitSchema, operations: unitOperations, rows: units, start, stop, invoke: systemd });
```

A `live` field is set by the process and stored nowhere. A client draws it as state, never in a form, and a write to it is refused. The mark is on the schema because it says what the field is, not how a list uses it.

### How the instance is correlated

Each ahpd host serves its own machine's services, so a kind has one instance: the machine.

| Where | Value |
| --- | --- |
| A row's URI | `service://build-01/web` |
| A row in the channel | `{ "id": "web", "instance": "build-01", "kind": "process-compose", "record": { ... } }` |

A host that runs sessions in machines, as ahpd's machines do, could add each machine as an instance. Nothing here needs that yet.

### Deploy

beorn's deploy is one operation on every service with a deploy declaration, whatever its kind. It fetches, builds, switches and checks, rolls back on a failed check, and keeps the last N releases. It takes minutes.

```ts
// in the deploy plugin
host.registerOperation({
  channel: 'x-ahpd-services',
  kinds: ['process-compose', 'systemd'],
  operation: { id: 'deploy/deploy', label: 'Deploy', icon: 'rocket', long: true,
               input: { type: 'object', required: ['version'], properties: { version: { type: 'string', title: 'Version' } } },
               offered: (s) => s.deploy !== undefined },
  invoke: (row, report, input) => deploy(row, input.version, report),
});
```

`registerOperation` is new: an operation from a plugin onto kinds it did not register. It reaches every record of the kinds it names, and `offered` shows it only on a service with a deploy declaration. Its id, `deploy/deploy` here, is open point 1.

`build` and `check` are commands the host runs. beorn keeps them on the service's own record, so `deploy:deploy` alone chooses no command. Who may write the deploy declaration decides who may run code on the machine.

### What this example needs from the shape

- **A runtime class**, with live fields that nobody stores.
- **Two kinds with different forms in one list**, filtered on the fields they share.
- **An operation from another plugin**, on rows of every kind.
- **A long operation**, with a state a person can follow for minutes, and a log.

## Example: a CRM with kinds from several plugins

A `crm` plugin keeps clients, tickets and interactions in its own store. A mail plugin adds emails to the interactions, and a phone plugin adds calls. No plugin owns the interactions list. This is the case for several plugins in one list, each keeping its own kind's rows, and links between lists.

It is [a-crm-is-the-second-example-kind.md](a-crm-is-the-second-example-kind.md), written with the list's filters and sorts.

### The lists

```ts
// in @local/crm
host.registerList({ name: 'client', channel: 'x-ahpd-clients', title: 'Clients',
  search: ['name', 'email'],
  sorts: ['name'], defaultSort: 'name' });

host.registerList({ name: 'interaction', channel: 'x-ahpd-interactions', title: 'Interactions',
  filters: [
    { field: 'ticket', type: 'uri', channel: 'x-ahpd-tickets' },
    { field: 'client', type: 'uri', channel: 'x-ahpd-clients' },
    { field: 'at', type: 'range' },
  ],
  sorts: ['at'], defaultSort: '-at', page: { size: 50 } });
```

The mail plugin declares `interaction` too, with the same name, so it works without the CRM. Its declaration joins the CRM's. The first one loaded gives the title, and a declaration that differs is a warning on its plugin's row.

### Kinds from three plugins

Every kind in `interactions` has the fields the list filters and sorts on: `ticket`, `client`, `at` and `summary`. Each adds its own.

```ts
// in @local/crm
host.registerKind({ channel: 'x-ahpd-interactions', name: 'note', title: 'Note', class: 'data', rows: notes,
  schema: { type: 'object', required: ['client', 'summary'], properties: {
    client:  { type: 'string', format: 'uri', title: 'Client' },
    ticket:  { type: ['string', 'null'], format: 'uri', title: 'Ticket' },
    at:      { type: 'string', format: 'date-time', title: 'When', readOnly: true },
    summary: { type: 'string', title: 'Note', format: 'textarea' } } },
  relations: { client: { channel: 'x-ahpd-clients', one: 'client' }, ticket: { channel: 'x-ahpd-tickets', one: 'ticket' } } });

// in @local/mail
host.registerKind({ channel: 'x-ahpd-interactions', name: 'email', title: 'Email', class: 'data', rows: emails,
  schema: emailSchema,                 // client, ticket, at, summary, plus to, subject, body, state
  operations: [{ id: 'send', label: 'Send', icon: 'send', offered: (email) => email.state === 'draft' }],
  relations: { client: { channel: 'x-ahpd-clients', one: 'client' }, ticket: { channel: 'x-ahpd-tickets', one: 'ticket' } },
  invoke: (operation, row, report) => mail.send(row, report) });

// in @local/phone
host.registerKind({ channel: 'x-ahpd-interactions', name: 'call', title: 'Call', class: 'data', rows: calls, schema: callSchema, relations });
```

The interactions list declares no `instances`, so a row is `interaction://i-88`. The tickets list declares `instances` for Desk's connectors, so the CRM's ticket kind adds an instance of its own, `local`: `ticket://local/t-1042`.

### Links between lists

| From | Field | To | Drawn as |
| --- | --- | --- | --- |
| An interaction | `client` | one row of `clients` | a picker in the form, a link in the row |
| An interaction | `ticket` | one row of `tickets` | the same |
| A ticket | `interactions` | many rows of `interactions`, by their `ticket` field | a list of rows |

A ticket's interactions are read as `x-ahpd-interactions://?ticket=ticket://local/t-1042`, a filter the interactions list declares.

### A send

```jsonc
{ "jsonrpc": "2.0", "id": 9, "method": "x-ahpd/invokeOperation",
  "params": { "channel": "x-ahpd-interactions://", "operationId": "email/send", "target": { "id": "interaction://i-88" } } }
```

The host finds the kind from the row, and hands the call to the mail plugin's `invoke`. While the mail server answers, the row's `operation` is `{ "id": "email/send", "status": "running" }`. Later the mail plugin learns the email bounced and changes the row itself, and every reader of the list hears it.

### What this example needs from the shape

- **A list no plugin owns**, joined by a declaration with the same name.
- **Kinds from several plugins that share the list's fields**, each with its own form and operations.
- **Relations across lists**, both one and many, with the many side read through a filter.
- **A kind that changes its own rows** after an operation has answered.

## Open points

1. **The id of an operation a plugin registers onto kinds it did not register.** Settled on 2026-11-26 in [a plugin adds operations to kinds](../plans/plugin/20261126-0538-a-plugin-adds-operations-to-kinds/plan.md): `<kind>/<operation>` under each kind, and `<plugin>/<operation>` on a list. An operation id is `<kind>/<operation>`, but deploy's is `deploy/deploy`, where `deploy` is the plugin and no kind. Deploy alone is one case, so these are written to settle it from more than one:

   | Plugin | Operation | Onto | What it shows |
   | --- | --- | --- | --- |
   | deploy | Deploy a version | `process-compose` and `systemd` in `services` | long, and on some records only, by `offered` |
   | crm | Link to a ticket | `email` and `call` in `interactions`, kinds of the mail and phone plugins | onto kinds of two other plugins, with a ticket picker as input |
   | a translation plugin | Translate | any `data` kind with text fields, in any list | onto kinds of several lists |
   | an agent plugin | Send to an agent | `desk-ticket` and a GitHub kind in `tickets` | onto rows kept outside ahpd |
   | a backup plugin | Export | every kind of a list | on the list as a whole, `list` scope, no row |

2. **Desk and the CRM on the same lists.** Desk's tickets relate to `client://desk-production/5120` and to interactions, so the `desk` plugin declares `clients` and `interactions` with `instances`. The CRM declares both without. With both plugins loaded, the first declaration gives the form, and the other plugin's rows do not fit it.

*Not covered yet* lists what the brief does not say.

## Not covered yet

- **A kind on a plugin's own channel.** `registerKind` joins a list. Joining a `registerChannel` channel needs the channel's state to hold the kinds' rows, its operations to reach the kinds, and its owner to allow it.
- **What beorn's services plugin also has:**
  - alerts on a row and on the list;
  - a resource per row, such as its logs;
  - editing a row against a version;
  - secrets in a kind's schema;
  - rows that cannot be read.
- **A better first example.** Issues from GitHub and GitLab show instances better than Desk's production and staging.
- **The row's scheme.** `name` is now only a row's scheme and its grants' subject.
