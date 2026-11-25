---
title: A plugin that failed to load can be updated from a client
domain: daemon
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://f7184a040 - the last commit that holds the problem a-client-cannot-update-a-scoped-plugin-that-failed-to-load.md, which this plan fixes
  - "[code://packages/server/src/plugins.ts#L137-L171](../../../../packages/server/src/plugins.ts#L137-L171) - `pluginIdOf`, `unimportedId` and `provisionalOf`: a refused plugin's id is its spec as written"
  - "[code://packages/server/src/plugins.ts#L156](../../../../packages/server/src/plugins.ts#L156) - `unscoped`, the slug a loaded scoped plugin gets"
  - "[code://packages/server/src/plugins.ts#L260](../../../../packages/server/src/plugins.ts#L260) - `packageNameOf`, a spec's package name without its version"
  - "[code://packages/server/src/pluginschannel.ts#L387-L458](../../../../packages/server/src/pluginschannel.ts#L387-L458) - `idOf`, `specOf` and `idParam`, which refuses an id with a `/`"
  - "[code://packages/server/test/plugins-channel.test.ts#L1447](../../../../packages/server/test/plugins-channel.test.ts#L1447) - the update cases"
  - plans/daemon/40-a-daemon-starts-with-no-backend/plan.md - the path for a person with no shell on the host, which this restores
---

## Goal

A client updates a first-party plugin that the daemon refused to load, such as a 0.14 backend on a 0.15 daemon.
This is the path 0.15's upgrade notes give a person with no shell on the host.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- A plugin that loads gets a slug from its manifest, unscoped, such as `agent-claude`.
- A plugin the daemon refuses keeps its spec as its row id, such as `@ahpd/agent-claude`.
- `x-ahpd/plugins/update` refuses `@ahpd/agent-claude` for its `/`, and refuses `agent-claude` as no configured plugin.

### Searches performed

- `rg "idParam\(" packages/server/src/pluginschannel.ts` - every command that names a plugin goes through it.
- `rg "unscoped|packageNameOf" packages/server/src/plugins.ts` - the slug and the package name helpers that exist.

### Gaps

- A refused scoped plugin has an id no command accepts.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A plugin that did not load is named by its package name without its scope or its version, such as `agent-claude` | Softov, 2026-11-18: "agent-claude (Recommended)", in [decisions/a-refused-plugin-is-named-without-its-scope.md](../../../decisions/a-refused-plugin-is-named-without-its-scope.md) | 01 |
| `idParam` takes an id that a row of the plugins list answers, a `/` included | (defaulted: the problem's second step) | 01 |
| An id with a `?`, or one no row answers, is refused as today | (defaulted: only a row's own id is newly taken) | 01 |

## Proposed architecture

- **Data flow** - `unimportedId` and the loader answer the package name without its scope for a refused package spec. `idParam` checks an id against the rows before it refuses a `/`.
- **Layer responsibilities** - server: `plugins.ts`, `pluginschannel.ts` · docs: the notes.
- **Source-of-truth files** - [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a refused plugin has an id a client can name](task-01-a-refused-plugin-has-a-usable-id.md) | done | - |

## Risks and tradeoffs

- A refused plugin's row id moves from its spec to its slug - `specOf` still takes the spec, so an old id still works.

## Resume state

- **Done so far:** task 01. The loader names a refused plugin too, so `refusedId` is used there and in `unimportedId`.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** a spec that is a path or a URL has no package name, and keeps the id it has today.

## Final verification checklist

- [ ] On the test daemon with `@ahpd/agent-claude@0.14.0` in `plugins`, the row id is `agent-claude`, and `x-ahpd/plugins/update` with that id moves it to the version that fits.
- [ ] The server suite passes, and `check` and `check-windows` are green.
