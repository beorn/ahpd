---
title: A refused plugin is named without its scope
status: accepted
date: 2026-11-18
refs:
  - "[code://packages/server/src/plugins.ts](../../packages/server/src/plugins.ts) - `refusedId`, the id of a plugin the daemon refused to load"
  - "[code://packages/server/test/plugin-ids.test.ts](../../packages/server/test/plugin-ids.test.ts) - each first-party plugin exports its package name without the `@ahpd/` scope"
---

## Context

A plugin the daemon refuses to load runs no code, so it names no id of its own. An update of the daemon can leave such a plugin behind.
A client can update it only by an id that the plugins list shows and a command accepts. A scoped package name has a `/`, which the commands refuse.

## Decision

A refused plugin is named by its package name without its scope or its version: `@ahpd/agent-claude` is `agent-claude`.
A spec that names no package, such as a path or a URL, keeps the spec as its id.

## Consequences

The row keeps one id before and after an update that lets the plugin load, since a first-party plugin calls itself by that same name.
Two packages with one name in two scopes get one id. The loader then refuses the second as a plugin configured twice.

## Options

- The scope joined by a dash, `ahpd-agent-claude`, as a located plugin is named before its import. It lost because the row changes its id once the update loads the plugin. Softov, 2026-11-18: "agent-claude (Recommended)".
