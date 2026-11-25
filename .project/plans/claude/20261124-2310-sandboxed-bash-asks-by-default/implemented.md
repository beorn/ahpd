---
title: A sandboxed Bash command asks by default - implemented
date: 2026-11-24
refs:
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - the option and the join"
---

A Claude record's `sandbox: on` asks before a sandboxed Bash command. The record's `autoAllowBashIfSandboxed` lets it run with no question.

For `v0_16.md`: a session with the sandbox on now asks, and under `dontAsk` the command is denied. Set `autoAllowBashIfSandboxed` to keep the old behaviour.

## Verified

- The declaration cases, with the option on, off, absent, and with the sandbox off.
- The whole suite: 10559 cases passed, and the two that list the options failed. Both are updated, and the agent-claude suite passes.
- The Claude CLI of SDK 0.3.325, on Linux. With the sandbox alone it asked, and with the option it did not. Under `dontAsk` it denied the command, and ran it with the option.

## Departures from the plan

- The package's `package.json` lists no record option, so it did not change.
- The option has no catalog entry. No other Claude record option has one.
