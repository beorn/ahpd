---
title: The documents say it
status: done
depends: [02]
layer: "docs"
refs:
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the protocol page"
  - "[code://UPSTREAM.md#L11-L17](../../../../UPSTREAM.md#L11-L17) - Pass 8"
---

## Objective

The protocol page says that `chat/moved` is sent and that a chat moves across agents, and UPSTREAM.md ticks the box.

## Files

- `UPDATE: docs/sdk/AHP.md` - `chat/moved` is built, and a move across agents.
- `UPDATE: UPSTREAM.md:11-17` - tick the `chat/moved` box.

## Steps

1. Move `chat/moved` from not built to built in `docs/sdk/AHP.md`.
2. Add one sentence on a move across agents.
3. Tick the box in Pass 8.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

Done on 2026-11-24. Two rows of `docs/sdk/AHP.md`, and the box of Pass 8.
