---
title: A tunnel row names its Dev Tunnel
created: 2026-11-18
refs:
  - git://08ad22fee - the commit of this repository the facts were checked at
  - "[code://packages/sdk/src/types/tunnels.ts#L40-L62](../../packages/sdk/src/types/tunnels.ts#L40-L62) - `TunnelReport`, which carries a status, a URL, an error and settings, and no field that names the tunnel"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L538-L555](../../packages/tunnel-devtunnel/src/kind.ts#L538-L555) - `start` holds the Dev Tunnel's id and labels, and says them only in a log line for the system tunnel"
  - "[code://packages/tunnel-devtunnel/src/discovery.ts#L62-L75](../../packages/tunnel-devtunnel/src/discovery.ts#L62-L75) - `displayLabel`, the name VS Code shows for a tunnel"
  - "[code://packages/tunnel-devtunnel/src/view.ts#L15-L25](../../packages/tunnel-devtunnel/src/view.ts#L15-L25) - `TunnelState`, the system tunnel's page, which already holds the tunnel id"
  - https://github.com/microsoft/vscode/blob/53fa24195c2/cli/src/tunnels/dev_tunnels.rs - VS Code's CLI names a tunnel by its label and keeps its id and cluster
---

# A tunnel row names its Dev Tunnel

Softov wants a tunnel row in ahpw to show which Dev Tunnel it is. On 2026-11-18 the row for port 31546 showed only `https://hwnqpfb0-31546.brs.devtunnels.ms/`, and `ahpc tunnel list` named tunnels as `tunnel:<id>.<cluster>` with a display name. Nothing on the row tied it to that list, to VS Code's picker, or to the `devtunnel` command.

## What others do

- VS Code's Remote Tunnels list names a tunnel by its display label. That is the first label that is not the launcher label, a protocol label or one starting with `_`.
- ahpc's `tunnel list` prints that display name, `tunnel:<id>.<cluster>`, and whether a host is online: https://github.com/ahpio/ahpc/blob/903c5d2/src/ahp/devtunnels.ts#L310-L363.
- The `devtunnel` command lists a tunnel by its id and cluster.

## What ahpd has today

- `TunnelReport` has `status`, `url`, `error` and `settings`. A kind has no field to say which remote thing a record is.
- `start` reads the tunnel's id and labels from the service. It says them only in the log line of the system tunnel, `tunnel <id> (<label>), port <port>`.
- The system tunnel's page, `TunnelState`, holds the tunnel id. A person's tunnel has no page.
- The id is also the input of the derived token, so a person who checks a token needs it.

## Who writes

At `08ad22fee`, no open PR and no remote branch touches `packages/tunnel-devtunnel`. None touches `packages/sdk/src/types/tunnels.ts` either. ahpw draws what the host sends, so the field shape decides whether ahpw needs a change.

## The change

- A running devtunnel record reports its Dev Tunnel's id, its cluster and its display name.
- The id and cluster are written as ahpc writes them, `tunnel:<id>.<cluster>`, so a person can match the row to `ahpc tunnel list`.
- A record that is not running reports none of them.

## Open points

- The field: a new optional field on `TunnelReport` that every kind may fill, or a value the devtunnel kind puts in an existing field. A new field is an sdk change that ahpw then draws.
- On 2026-11-18, `ahpc tunnel list` named two tunnels, and neither was `hwnqpfb0`. Why the row's tunnel was not listed was not checked.
