---
title: An emptied field is not set
domain: plugin
status: built
priority: medium
created: 2026-11-19
revalidated: 2026-11-19
refs:
  - "[code://packages/sdk/src/kinds/operations.ts#L182-L198](../../../../packages/sdk/src/kinds/operations.ts#L182-L198) - `inputOf`, which checks an operation's input against its schema, and refuses `\"\"` in a field whose pattern does not take it"
  - "[code://packages/sdk/src/kinds/operations.ts#L240-L243](../../../../packages/sdk/src/kinds/operations.ts#L240-L243) - the input `inputOf` answers is the one the channel runs with"
  - "[code://packages/sdk/src/tunnels/channel.ts#L556-L573](../../../../packages/sdk/src/tunnels/channel.ts#L556-L573) - a tunnel's update keeps the settings it is sent and no others, so a field left out is cleared"
  - "[code://packages/tunnel-devtunnel/src/kind.ts](../../../../packages/tunnel-devtunnel/src/kind.ts) - the `person` setting, `^user:.+$`"
---

## Goal

A person who empties an optional field in a create or an edit form leaves that field not set.
On 2026-11-18 Softov emptied a tunnel's Person, and the edit was refused: `devtunnel/update's input.person must be text matching ^user:.+$`. Only an edit of the JSON took the field out.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

- ahpw sends an emptied text field as `""`.
- `inputOf` checks every operation's input, for every channel that offers operations, so one change there covers every form.
- A tunnel's update stores the settings it is sent and no others, so a field that is absent is cleared.

### Searches performed

- `rg "check\(input, operation.input" packages/sdk/src/kinds` - the one check every operation's input meets.

### Gaps

- No input path reads `""` in an optional field as absent.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host reads `""` in an optional field as absent, before the check | Softov, 2026-11-19: "In the host (Recommended)" | 01 |
| Only a field the schema does not require, and whose schema refuses `""`, is dropped | (defaulted: a `""` the schema takes is a value the person meant) | 01 |
| A field marked `secret` keeps its `""` | (defaulted: a blank secret means the stored one stays, and the tunnels channel resolves it; a drop would erase the secret) | 01 |
| Only the top-level fields of the input | (defaulted: a form edits top-level settings) | 01 |
| The check of the field's own schema is the `check` the operation already uses | (defaulted: one validator, so the two never differ) | 01 |

## Proposed architecture

- **Data flow** - `inputOf` drops each optional field that is `""` where its schema refuses `""`. It then checks the input, and the channel runs with the rest.
- **Layer responsibilities** - sdk: `kinds/operations.ts` · docs: the notes.
- **Source-of-truth files** - [`code://packages/sdk/src/kinds/operations.ts`](../../../../packages/sdk/src/kinds/operations.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an emptied field is dropped](task-01-an-emptied-field-is-dropped.md) | done | - |

## Risks and tradeoffs

- A `""` sent on purpose to such a field clears it, with no refusal - its schema says `""` is no value it holds.

## Resume state

- **Done so far:** task 01, merged in #384 as `05fa09ecf`. See [implemented.md](implemented.md).
- **Next action:** none. Softov's check in ahpw passed on 2026-11-19.
- **Open questions:** none.
- **Watch out for:** a required field keeps its refusal, so a form still says it must be filled.

## Final verification checklist

- [x] In ahpw, a tunnel's Person emptied and saved leaves the record with no `person`.
- [x] The sdk suite and the server suite pass, one at a time, and `check` and `check-windows` are green.
