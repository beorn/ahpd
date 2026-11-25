---
title: configure asks on the cofold prompts - implemented
date: 2026-11-21
refs:
  - "[code://packages/server/src/ask.ts](../../../../packages/server/src/ask.ts)"
  - "[code://packages/server/test/answers.ts](../../../../packages/server/test/answers.ts)"
  - "[code://packages/server/test/server-ask.test.ts](../../../../packages/server/test/server-ask.test.ts)"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts)"
  - npm://@cofold/terminal@0.5.0 - the prompts
---

`ask`, `choose` and `confirm` draw on `createPrompts` from `@cofold/terminal` 0.5.0.
The questions, their order and their defaults are the same, and `configure` is unchanged.

Task 04 later replaced the per-item questions with one multiselect for the backends, the other plugins and the agents found. The suite and typecheck were run again after that change.

Task 05 added ACP as a backend that is on by default, and the eight main plugins to the other list, all on by default. The found agents print after ACP is answered on.

Task 06 asks each ACP agent this machine does not have as an install, which runs only when it is ticked and one confirm says yes. It also asks the HTTP API and the model gateway as a switch and a port. The full server suite passes: 99 files, 1993 tests, 3 skipped.

Verified on 2026-11-21 in the worktree:

- `pnpm typecheck` exits 0.
- `pnpm exec vitest run packages/server/test --maxWorkers=2` passes: 99 files, 1993 tests, 3 skipped. A run with the default worker count failed 32 tests in the tunnel, restart and HTTP files, all timeouts while the machine was loaded; those files pass at two workers.
- `ahpd configure` run on a pty draws the cofold frames for each question, and Enter keeps each default. It was run again after the closing summary.
- `ahpd configure` with stdin from `/dev/null` refuses with the no-terminal message and prints nothing else.

Where it departs from the plan:

- A list is answered by arrow keys. Typing a number or a name no longer selects a choice; the readline tests that did so were rewritten to move the cursor.
- An unknown key at a yes or no waits for the next key. The readline version asked again with a message; the two tests that checked the message were removed, because the cofold prompt does not print one.
- A cancel and a closed input both give "The terminal closed before the question was answered." The test helper `test/answers.ts` drives prompts with keys, and the 59 tests in the two files keep their meaning.
- `pnpm-workspace.yaml` has `@cofold/terminal@0.5.0` in `minimumReleaseAgeExclude`.
- The backends, the other plugins and the found agents are each one list with the current set ticked. Only the removal of the ACP pi agent stays a yes or no, since it follows from the backend choice.

After the plan was built, in PR #405:

- A refusal of every folder prints the reason and asks the folders again, rather than stopping the run.
- The install list holds each package once, since `@ahpd/agent-acp` is both a backend and the package a taken agent runs through.
- A run ends with a "Configuration saved" group, a "What's next?" group with the commands in cyan, and "Done.", drawn by `report` in `ask.ts`. Without a terminal the commands are plain lines.
- `ahpd start` ends with a "Daemon started" group: where it listens, its pid, its sessions, its log and any skipped plugin, then `ahpd status` and `ahpd stop`. `started` in `ask.ts` draws it, and a run without a terminal or with `--json` keeps the plain lines.
- `Term` takes an optional `unicode`, passed to the prompts. The test terminal sets it, because a Windows runner draws ASCII marks and `answers.ts` finds a question by `◆` and its end by `◇`. Without it every configure case after the first question waited out its timeout on Windows.
- CI shards the unit files by recorded time, from `tools/test-timings.json`, and the test steps may run 450 s.
