---
title: The option decides
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/options.ts#L38-L56](../../../../packages/agent-claude/src/options.ts#L38-L56) - the option and the join"
---

## Objective

`autoAllowBashIfSandboxed` of a Claude record decides whether a sandboxed Bash command runs without a question. With no value, the SDK and the settings files decide.

## Files

- `UPDATE: packages/agent-claude/src/options.ts` - `sandbox` stops sending the key, the new option sends it, and the join keeps both.
- `UPDATE: packages/agent-claude/test/agent-claude-declarations.test.ts` - the cases of the option.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the sandbox alone.
- `UPDATE: packages/agent-claude/test/engine.test.ts` - the sandbox alone.
- `UPDATE: packages/sdk/test/host-sessionconfig.test.ts` - the sandbox alone.
- `DELETE: .project/ideas/sandboxed-bash-asks-as-the-sdk-default.md` - this plan covers it.

## Steps

1. Add the option beside `sandbox`, with its text in the catalogs.
2. Make the options join merge `settings.sandbox` instead of replacing `settings`.
3. Change the cases that expect the key with the sandbox alone.
4. Add cases for the option on, off and absent, and for the sandbox off.
5. Write the changed default in `implemented.md`, for `v0_16.md`.

## Validation

- The agent-claude and sdk suites pass, and `pnpm i18n` passes.
- With the real CLI, a sandboxed command asks.
- With the option on, it runs with no question.
- With `dontAsk` and the option off, the CLI denies it.

## Resume

Done 2026-11-24. See [implemented.md](implemented.md).
