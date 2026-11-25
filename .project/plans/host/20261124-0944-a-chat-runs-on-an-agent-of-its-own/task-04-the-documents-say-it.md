---
title: The documents say it
status: done
depends: [03]
layer: "docs"
refs:
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the protocol page"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - Pass 8"
---

## Objective

The protocol page and the configuration page say how chats of other agents work and how to turn them off, and UPSTREAM.md ticks the box.

## Files

- `UPDATE: docs/sdk/AHP.md` - one paragraph on chats with their own agent.
- `UPDATE: UPSTREAM.md:11-17` - tick the box of chats with their own agent.

## Steps

1. Add the paragraph to `docs/sdk/AHP.md`, with the setting and its default.
2. Run `rg -l "chatMoves.enabled" docs`, and add the new key beside it in each file.
3. Tick the box in Pass 8.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

Done on 2026-11-24. The `createChat` row of `docs/sdk/AHP.md`, and the box of Pass 8. No docs page lists the root keys.
