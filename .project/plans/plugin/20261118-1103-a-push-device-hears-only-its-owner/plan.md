---
title: A push device hears only its owner's openings
domain: plugin
status: built
priority: high
created: 2026-11-18
revalidated: 2026-11-18
refs:
  - git://ec71eff0e - the last commit that holds the problem a-push-device-hears-sessions-by-client-id-alone.md, which this plan fixes
  - "[code://packages/push/src/plugin.ts#L209-L234](../../../../packages/push/src/plugin.ts#L209-L234) - `opened` and `audience`: a device hears a session its client opened, matched by the client id alone"
  - "[code://packages/sdk/src/host/routing.ts#L321-L344](../../../../packages/sdk/src/host/routing.ts#L321-L344) - `openedBy`, which raises `session_opened` with the session and the client id"
  - "[code://packages/sdk/src/types/events.ts#L90-L96](../../../../packages/sdk/src/types/events.ts#L90-L96) - `SessionOpenedEvent`"
  - "[code://packages/sdk/src/host/owners.ts#L75](../../../../packages/sdk/src/host/owners.ts#L75) - `ownerFor`, the owner a connection is"
  - "[code://packages/push/README.md#L119](../../../../packages/push/README.md#L119) - which sessions a device hears"
---

## Goal

On a host with users, a push device hears a session its client opened only when the person who opened it is the device's owner.
A client id is what a connection says of itself, so a device registered with another person's client id hears nothing of theirs.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- `audience` takes a device by `byClient`, its client id among those that opened the session, or by `byPerson`, its owner the session's owner.
- `byClient` checks no owner, and a connection declares its own client id at `initialize`.
- `session_opened` carries the session and the client id, and not the person who opened it.
- `openedBy` has three callers, each with the connection at hand.

### Searches performed

- `rg "openedBy\(" packages/sdk/src/host` - `handshake.ts` twice and `sessionmethods.ts` once.
- `rg "session_opened" packages` - the push plugin is the one listener.

### Gaps

- The push plugin cannot tell who opened a session through a client.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The client match checks the person who opened the session through that client | Softov, 2026-11-18: "The person who opened it" | 01 |
| `session_opened` gains `owner`, the opening connection's owner, where it has one | (defaulted: the push plugin needs it, and the event is where it hears of an opening) | 01 |
| A host with no users is unchanged | (defaulted: no device has an owner to check there) | 01 |
| The `person` match stays as it is | (defaulted: it already checks the session's owner) | 01 |

## Proposed architecture

- **Data flow** - `openedBy` takes the opener's owner and raises `session_opened` with it. The push plugin keeps each opening's client and owner, and `byClient` needs both to match.
- **Layer responsibilities** - sdk: `routing.ts`, `handshake.ts`, `sessionmethods.ts`, `types/events.ts` · push: `plugin.ts`, `README.md`.
- **Source-of-truth files** - [`code://packages/push/src/plugin.ts`](../../../../packages/push/src/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an opening says who opened it](task-01-an-opening-says-who-opened-it.md) | done | - |

## Risks and tradeoffs

- A plugin that listens to `session_opened` sees one more field - it is optional, so a listener that ignores it is unchanged.

## Resume state

- **Done so far:** task 01. The host raises `session_opened` once per client, session and owner, so a second person under the same client id is heard.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:** an opening is raised once per session and client, so the owner of that first opening is the one kept.

## Final verification checklist

- [ ] On the test daemon, bob registers a device with alice's client id, alice opens her session, and bob's device hears nothing.
- [ ] alice, an admin, opens bob's session through her client, and her own device hears it.
- [ ] The sdk, computer and push suites pass, one at a time, and `check` and `check-windows` are green.
