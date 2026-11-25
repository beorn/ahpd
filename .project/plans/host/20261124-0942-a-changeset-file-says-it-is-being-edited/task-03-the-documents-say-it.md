---
title: The documents say it
status: done
depends: [01, 02]
layer: "docs"
refs:
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the protocol page"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - Pass 8"
---

## Objective

The protocol page says what `Editing` and the nonce mean in ahpd, and UPSTREAM.md ticks the box.

## Files

- `UPDATE: docs/sdk/AHP.md` - one paragraph on `status` and the nonce.
- `UPDATE: UPSTREAM.md:11-17` - tick the changeset nonce and `isEditing` box.

## Steps

1. Add the paragraph to `docs/sdk/AHP.md`.
2. Tick the box in Pass 8.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

Done on 2026-11-24. Two rows of `docs/sdk/AHP.md`, and the box of Pass 8.
