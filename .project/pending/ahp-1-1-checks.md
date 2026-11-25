---
title: Check the rest of AHP 1.1.0 with a script
plans:
  - plans/host/20261124-0923-the-small-wire-items-of-ahp-1-1-0/plan.md
  - plans/host/20261124-0942-a-changeset-file-says-it-is-being-edited/plan.md
  - plans/host/20261124-0930-a-reasoning-part-says-how-long-it-took/plan.md
  - plans/host/20261124-0944-a-chat-runs-on-an-agent-of-its-own/plan.md
  - plans/host/20261124-0945-a-moved-chat-says-where-it-went/plan.md
  - plans/claude/20261124-0943-an-mcp-servers-skills-show-and-load/plan.md
---

# Check the rest of AHP 1.1.0 with a script

A script asks the test daemon for each of the six plans of 2026-11-24, and prints `PASS` or `FAIL` per line.

Not here: `accountId`, `resultMetadata`, cofold's and pi's restored reasoning times, and what a window draws. Their test cases cover the first three.

## Before you start

- `git`, `node` and `pnpm` are on the `PATH`.
- `/github/ahpd` can fetch from `origin`.
- The Claude CLI is signed in as you, for the six turns.
- Nothing of yours runs on port 39200. Ports 5180 and 37537 are not used.
- No client is needed: no VS Code and no ahpw.

## Run it

```bash
bash <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/ahp-1-1-checks.sh)
```

The script does each step:

1. It checks out `origin/main` in `/github/ahpd.worktrees/pending-check`, installs and builds.
2. It writes `~/ahpd-check/config/ahpd/config.json` with the Claude plugin and the check's own plugin, and keeps that file's other keys.
3. It starts the test daemon on port 39200.
4. It makes the folder `~/ahpd-check/work/ahp-1-1`, trusts it, and runs 20 checks with no model.
5. It runs 8 checks with six short Claude turns on Sonnet.
6. It restarts the test daemon and runs 4 checks.
7. It stops the test daemon.

It takes about two minutes after the build.

## Read the result

Pass: the last line before the daemon stops is `RESULT: every check passed.`, after 32 `PASS` lines.

Fail: the line is `RESULT: something failed.`, and each `FAIL` line has what the daemon answered under it.

`STOP` says what the script needs and did not find. Nothing was checked.

`SKIP` says that the model did not think, so its reasoning times were not checked. Run it again with `AHPD_MODEL=opus` before `bash`.

When it passes, the six plans can be `built`.
