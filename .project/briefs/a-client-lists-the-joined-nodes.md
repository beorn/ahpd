---
title: A client lists the joined nodes
created: 2026-11-18
refs:
  - git://8b7e8a6bd - the commit of ahpd the facts were checked at
  - "[code://packages/server/src/commands/nodes.ts#L52-L120](../../packages/server/src/commands/nodes.ts#L52-L120) - `node list`, `add` and `rm`, the CLI and HTTP routes that exist today"
  - "[code://packages/sdk/src/nodes.ts#L92-L106](../../packages/sdk/src/nodes.ts#L92-L106) - `Nodes`, whose `list` answers only each node's `id`"
  - "[code://packages/server/src/commands/join.ts#L363-L375](../../packages/server/src/commands/join.ts#L363-L375) - `node/hello`, in which a node says its ahpd version, its protocols and its working directory"
  - "[code://packages/sdk/src/clients/channel.ts](../../packages/sdk/src/clients/channel.ts) - `x-ahpd-clients://`, the records channel this one copies"
  - "[code://docs/plugins/PLUGINS.md#L1913](../../docs/plugins/PLUGINS.md#L1913) - what a row of `x-ahpd-clients` carries"
  - "[code://docs/plugins/COMPUTERS.md#L428](../../docs/plugins/COMPUTERS.md#L428) - *Joined nodes*: `ahpd node add`, `ahpd join`, and `node.<name>` as a computer"
  - https://github.com/ahpio/ahpw/blob/8eafeaf/src/resources/clients/channels.ts - ahpw's Clients area, drawn from `x-ahpd-clients://`
---

# A client lists the joined nodes

Softov wants a channel that lists the nodes of a hub, and an ahpw view that shows them with what the host knows about each.
Today a node is seen only through `ahpd node list`, which prints names, and as `node.<name>` among the computers while it is connected.

## What others do

The reference is ahpd's own `x-ahpd-clients://`, a records channel with one row per connection.
A row carries what the host knows of the connection: who, which client, where it came in and what it holds.
It also carries when a frame last crossed each way.
ahpw draws its Clients area from that channel with no code per field, so a field the host adds shows with no ahpw change.

## What ahpd has today

- The nodes file holds each node's id and the hash of its token. `Nodes.list` answers the ids alone.
- `ahpd node list` and `GET /node/list` print those ids, with `node:read`.
- `ahpd node add` and `ahpd node rm` change the file, with `node:write`.
- A joined node sends `node/hello` with `versions.ahpd`, `versions.protocol` and `workdir`.
- While it is connected, a client sees the node as the computer `node.<name>`. A session on it is made with `computer: "computer://node.<name>"`.
- No channel lists the nodes, and nothing tells a client whether a node in the file is connected, since when, or what its hello said.
- `x-ahpd-summary://` counts the areas plugins, connectors, agents, tunnels and clients, and has no area for nodes.

## Who writes

- No open PR on `ahpio/ahpd` at `8b7e8a6bd`.
- The 0.15.0 fix "A removed node is cut off at once", built as [container/20261118-1107](../plans/container/20261118-1107-a-removed-node-is-cut-off-at-once/plan.md), changes how a removed node is dropped. That fix and this channel both touch the hub's live registry of nodes.
- `/github/ahpw` is on another session's branch, and ahpw's main is `8eafeaf`. No ahpw branch names nodes.

## The change

- ahpd serves `x-ahpd-nodes://`, a records channel with one row per node in the file, read with `node:read`.
- A row carries the node's `id`, whether it is connected, and when it connected.
- A connected node's row also carries what its `node/hello` said: `versions.ahpd`, `versions.protocol` and `workdir`.
- A row carries the sessions running on the node, by URI, and the computer id `node.<name>` that a session names.
- A row carries when a frame last crossed each way, as a client row does.
- The channel sends a change when a node joins, leaves, is added or is removed.
- `x-ahpd-summary://` gets a `nodes` area with the total and the counts by connected and not connected.
- ahpw shows a Nodes area beside Clients, drawn from the channel's rows as the Clients area is drawn.
- Adding and removing a node stay `ahpd node add` and `ahpd node rm`.
- `docs/plugins/PLUGINS.md` and `docs/plugins/COMPUTERS.md` say what the channel holds.
