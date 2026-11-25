---
title: The documents say 1.1.0
status: done
depends: [04, 05, 07, 08, 09]
layer: "docs"
refs:
  - "[code://README.md#L9](../../../../README.md#L9) - the AHP badge"
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the protocol page"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - the Pass 8 items for 1.1.0"
---

## Objective

The README files, the protocol page and UPSTREAM.md say what ahpd serves of AHP 1.1.0, and what it leaves out.

## Files

- `UPDATE: README.md:9` - the badge says 1.1.0.
- `UPDATE: packages/*/README.md` - the badge says 1.1.0 in each package README that has one.
- `UPDATE: docs/sdk/AHP.md` - the shared pending list, the canvas `uri`, the annotations channel, and the parts left out.
- `UPDATE: UPSTREAM.md:11-17` - tick each box a task of this plan built.

## Steps

1. Run `rg -l "AHP-1.0.0" --glob README.md`, and change each badge to 1.1.0.
2. Add the pending list, the canvas `uri` and the annotations channel to `docs/sdk/AHP.md`, one paragraph each.
3. State in `docs/sdk/AHP.md` that a chat's config inherits its session's value, unlike 1.1.0.
4. State in `docs/sdk/AHP.md` that windowed delivery and the TCP channel are not served.
5. Tick each Pass 7 and Pass 8 box when its task has the status `done`.

## Validation

- `rg "AHP-1.0.0" --glob README.md` finds nothing.
- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

The 14 README badges say 1.1.0. `docs/sdk/AHP.md` says 1.1.0 at its top, with the negotiation, the refusal and the parts not served. It describes the canvas `uri` with `url` beside it, and the `ahp-annotations:` channel with both names. `chat/configChanged` moves into the chat table, `chat/moved` is listed as not built, and the table says 36 of 37. The `chatMutable` note no longer calls it undeclared. UPSTREAM.md ticks the steering and vendor boxes of Pass 7, and Pass 8 lists the package, the canvas `uri` and the annotations channel as built. `pnpm docs:build` passes, and the lint finds nothing new in either file.
