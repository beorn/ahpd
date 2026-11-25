---
title: A CRM is the second example of a thing and its kinds
created: 2026-11-23
refs:
  - git://5277544c0 - main when the facts were checked
  - "[briefs/a-todo-app-is-the-first-agent-app.md](a-todo-app-is-the-first-agent-app.md) - the first example, and the host parts this brief checks"
  - "[ideas/a-plugin-registers-a-thing-and-its-kinds.md](../ideas/a-plugin-registers-a-thing-and-its-kinds.md) - Softov's idea: \"crm clients, invoices, etc.\""
  - "[code://packages/sdk/src/resources/recordschannel.ts#L26-L45](../../packages/sdk/src/resources/recordschannel.ts#L26-L45) - a records channel reads every id for its snapshot, and filters each record with `mayRead`"
  - "[code://packages/sdk/src/connectors/fields.ts#L28-L30](../../packages/sdk/src/connectors/fields.ts#L28-L30) - `x-ahpd/completions`, the command a client asks a field's choices with"
  - "[code://packages/sdk/src/types/kinds.ts](../../packages/sdk/src/types/kinds.ts) - `KindOperation`, with `offered` and `grant`"
---

# A CRM is the second example of a thing and its kinds

Softov wants a second example beside the todo app, so the host parts are not shaped by what a todo needs. He named a CRM with clients, tickets and interactions, as a plugin. Softov, 2026-11-23: "A brief in ahpd". This brief writes that plugin with the host parts of the todo brief, and lists where they do not fit. Nothing is built from it.

## How the CRM differs from the todo app

| Need | Todo app | CRM |
| --- | --- | --- |
| Things | One | Three: clients, tickets, interactions |
| Kinds in a thing | One | Several, some from other plugins |
| Links between records | None | A ticket names its client, and an interaction names its ticket |
| Size | Tens of rows | Thousands of tickets |
| Who reads a row | Everybody | The team the ticket is assigned to |
| State that changes by itself | None | A ticket goes overdue, and an email is delivered or bounces |
| Operations | Done at once | Sending an email waits on a mail server |

## The plugin

The plugin `@local/crm` registers three things:

```js
host.registerThing({ name: 'client', title: 'Clients', description: 'A company or a person the team serves.' });
host.registerThing({ name: 'ticket', title: 'Tickets', description: 'One request from a client.' });
host.registerThing({ name: 'interaction', title: 'Interactions', description: 'One contact with a client: an email, a call or a note.' });
```

Each thing gets its channel and its row scheme, as the todo brief's *The thing and its kind* says. `x-ahpd-tickets://` lists the tickets, and `ticket://t-1042` is one ticket.

### Kinds from more than one plugin

The CRM registers the kinds it knows. A mail plugin adds the kind `email` to `interaction`, and a phone plugin adds `call`. No plugin owns `interaction`. The mail plugin declares it too, and its declaration joins the CRM's, as the todo brief's *The thing and its kind* says. Each kind has its own schema and operations, and a client draws each from the thing's entry in `ahpd.channels`.

```js
// in @local/crm
host.registerKind({ thing: 'ticket', name: 'request', title: 'Request', schema: requestSchema, operations: ticketOperations });
host.registerKind({ thing: 'ticket', name: 'incident', title: 'Incident', schema: incidentSchema, operations: incidentOperations });
host.registerKind({ thing: 'interaction', name: 'note', title: 'Note', schema: noteSchema });

// in @local/mail
host.registerThing({ name: 'interaction', title: 'Interactions', description: 'One contact with a client: an email, a call or a note.' });
host.registerKind({ thing: 'interaction', name: 'email', title: 'Email', schema: emailSchema,
  operations: [{ id: 'send', label: 'Send', icon: 'send', offered: (email) => email.state === 'draft' }] });
```

The thing's entry then lists kinds from two plugins:

```json
{ "scheme": "x-ahpd-interactions", "title": "Interactions", "grant": "interaction:get",
  "kinds": {
    "note": { "title": "Note", "plugin": "@local/crm", "schema": { "...": "the note's schema" }, "operations": [ "..." ] },
    "email": { "title": "Email", "plugin": "@local/mail", "schema": { "...": "the email's schema" },
      "operations": [ { "id": "email/send", "label": "Send", "icon": "send", "scopes": ["interaction"], "grant": "interaction:put" } ] }
  } }
```

### A ticket row

```json
{ "id": "t-1042", "kind": "incident", "owner": "team:support",
  "record": { "title": "Invoices do not load", "client": "client://acme", "priority": "high", "due": "2026-11-24T12:00:00Z", "state": "open" },
  "operations": ["incident/update", "incident/remove", "incident/assign", "incident/close"],
  "operation": { "id": "incident/assign", "status": "idle" } }
```

`record.client` is the URI of another thing's row. A form draws the field as a picker of clients.

### An email that is sent

A person or an agent sends a draft email:

```json
{ "jsonrpc": "2.0", "id": 21, "method": "x-ahpd/invokeOperation",
  "params": { "channel": "x-ahpd-interactions://", "operationId": "email/send", "target": { "id": "i-88" } } }
```

The row shows `"operation": { "id": "email/send", "status": "running" }` until the mail server answers. Later the mail plugin learns that the email bounced, and changes the row by itself. Every reader of the channel, and every watch on `interaction://i-88`, hears it.

### The tools

The CRM opts in, so each operation is a tool, as the todo brief's *The tools* says. An agent that answers a ticket calls the email's `send` and the incident's `close`.

### A ticket as an artifact

A session that works on a ticket records `ticket://t-1042` with `add_artifact_or_reference`. A ticket is what a session follows until it is done, so it fits an artifact integration better than a todo does:

- The state on the pill: open, overdue, waiting on the client.
- Actions: assign, close, and a `prompt` action, "draft a reply", for the agent.
- Automation: "close the ticket when the client confirms", and "draft a reply when the client writes".

## Where the todo brief's host parts fit

| Host part | Fits the CRM | What is missing |
| --- | --- | --- |
| A thing and its kinds | Yes. Kinds from two plugins in one thing is the case it is for | Nothing: no plugin owns a thing, and a declaration with the same name joins it |
| The thing's entry in `ahpd.channels` | Yes | A kind names its plugin, so a client can say where it came from |
| The row: `id`, `kind`, `owner`, `record`, `operations`, `operation` | Yes | `owner` is a team here, not a person |
| The row scheme and a watch | Yes | Nothing |
| Operation status on the row | Yes, and the CRM needs it more than the todo app | Nothing |
| Opt-in tools | Yes | Nothing |
| The channel's snapshot | No. It sends every row, and a records channel reads every id | A query on the channel URI, as *Answers* says |
| A field that names another row | No | The mark `x-ahpd-row`, as *Answers* says |
| A row the kind changes by itself | Partly. A tunnel kind reports its state | The `rows` handle of `registerKind`, as *Answers* says |
| Who reads a row | Partly. A records channel has `mayRead` | The owner by default, and a kind's own `mayRead`, as *Answers* says |

## Answers

Softov, 2026-11-23, chose each of these.

### A large thing: a query on the channel URI

"Query on the channel URI". A client subscribes to part of a thing with a query, as `?owner=me` works on the computers and users channels today:

```json
{ "jsonrpc": "2.0", "id": 30, "method": "subscribe",
  "params": { "channel": "x-ahpd-tickets://?state=open&owner=team:support&sort=due&limit=50" } }
```

- Each query is its own subscription, with its own live changes.
- `after=<id>` asks for the next page.
- A kind declares the fields a query may filter and sort by. A query on any other field is refused.
- A row that leaves the query, such as a ticket that is closed, arrives as `removed` for that subscription.
- A channel URI with no query lists the whole thing, as today.

### A field that names a row: a mark like the connector's

"A mark like the connector's". The mark copies `x-ahpd-connector`:

```json
"client": { "type": "string", "title": "Client", "x-ahpd-row": "client" }
```

- The value is the row's URI, such as `client://acme`.
- On a save the host checks that the row exists, and that the writer may read it.
- A client draws a picker. Its choices come from `x-ahpd/completions`, as a connector field's do.
- A field whose row was removed keeps the URI, and a client shows it as missing.

### A kind's own change: a handle from `registerKind`

"A handle from registerKind". `registerKind` answers `rows`, which changes that kind's rows only:

```js
const emails = host.registerKind({ thing: 'interaction', name: 'email', /* ... */ });

mail.on('bounce', async (id) => {
  await emails.rows.update(id, { ...(await emails.rows.get(id)).record, state: 'bounced' });
});
```

- `rows` has `get(id)`, `update(id, record)` and `remove(id)`.
- The host checks the record against the kind's schema, and keeps the row's `id`, `kind` and `owner`.
- The change takes the same path as an operation's: the channel's subscribers and every watch on the row hear it.
- The change records the kind as its author, since no person made it.

### Who reads a row: the owner by default, the kind may change it

"Owner by default, kind may change it".

- By default a row is read by its owner, a person or the members of a team, and by the holders of `<name>:get`.
- A kind may give its own `mayRead(row, reader)`, which replaces the default for its rows.
- One answer serves the channel, `resourceRead` and the watch, through the records channel's `mayRead`.
