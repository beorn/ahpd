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

The protocol page says that a Claude session's MCP servers list their skills, and UPSTREAM.md lists the item as built.

## Files

- `UPDATE: docs/sdk/AHP.md` - one paragraph on MCP-served skills.
- `UPDATE: UPSTREAM.md:11-17` - add the item, ticked.

## Steps

1. Add the paragraph to `docs/sdk/AHP.md`, with the SEP-2640 link.
2. Add the item to Pass 8, ticked.

## Validation

- `node /home/softov/.claude/skills/do-spec/scripts/lint-prose.mjs docs/sdk/AHP.md` shows no new finding.
- `pnpm docs:build` passes.

## Resume

Done on 2026-11-24. A section of `docs/sdk/AHP.md`, and an item of Pass 8.
