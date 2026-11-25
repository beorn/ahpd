---
title: The guide section and its running pages
status: todo
depends: []
layer: "docs"
refs:
  - "[code://docs/.vitepress/config.mts#L18-L117](../../../../docs/.vitepress/config.mts#L18-L117) - the sidebar and its check"
  - "[code://docs/README.md](../../../../docs/README.md) - the index"
  - "[code://docs/index.md](../../../../docs/index.md) - the home page"
---

## Objective

`docs/guide/` exists, first in the index, the sidebar and the home page.
It holds the four pages about running ahpd: sessions, clients, remote access and diagnostics.

## Files

- `CREATE: docs/guide/SESSIONS.md` - sessions that keep running, from `sdk/SESSIONS.md` and `sdk/CHATS.md`.
- `CREATE: docs/guide/CLIENTS.md` - the clients on each device, from `server/CONNECT.md` and the README's client list.
- `CREATE: docs/guide/REMOTE.md` - remote access, from `server/REMOTE.md` and `plugins/tunnel-devtunnel.md`.
- `CREATE: docs/guide/DIAGNOSTICS.md` - status, doctor, logs and telemetry, from `server/RUN.md`.
- `UPDATE: docs/.vitepress/config.mts:22` - a Guide group first, with these four pages.
- `UPDATE: docs/README.md` - a `guide` section first, one line for each page.
- `UPDATE: docs/index.md` - a Guide feature card first, which opens `guide/SESSIONS`.
- `UPDATE: .project/plans/documentation/00-documentation.md` - the fourth folder, for a person who uses ahpd.

## Steps

1. Write each page in the four parts of the plan's *Page shape*.
2. Check each fact against the code and the page it links.
3. Add the Guide group first in the sidebar, with one entry for each page.
4. Add the `guide` section first in `docs/README.md`.
5. Add the Guide card first on the home page.
6. Add the guide folder to the domain reference.

## Validation

- `pnpm docs:build` passes.
- Each link on the four pages resolves in the built site.
- Softov reads the four pages.

## Resume

