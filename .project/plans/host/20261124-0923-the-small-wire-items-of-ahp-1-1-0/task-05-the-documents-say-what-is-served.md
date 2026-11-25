---
title: The documents say what is served
status: done
depends: [01, 02, 03, 04]
layer: "docs"
refs:
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the protocol page"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - Pass 8"
---

## Objective

The protocol page says what ahpd serves of the six items, and UPSTREAM.md ticks the boxes this plan built.

## Files

- `UPDATE: docs/sdk/AHP.md` - the path style, the ranged read, any origin, `accountId`, `resultMetadata`, and that a telemetry channel answers no snapshot.
- `UPDATE: UPSTREAM.md:11-17` - tick `resultMetadata`, and add the other items as built.

## Steps

1. Add one sentence for each item to `docs/sdk/AHP.md`.
2. Say that a plugin scheme may answer a ranged read whole.
3. Tick the `resultMetadata` box in Pass 8, and add the other five items, each ticked.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

Done on 2026-11-24. `docs/sdk/AHP.md` has the three rows and two paragraphs. UPSTREAM.md ticks six boxes.
