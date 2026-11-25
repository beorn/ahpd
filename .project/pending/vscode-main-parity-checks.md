---
title: Check the VS Code main parity in VS Code, ahpw and rpc
plans:
  - plans/host/20261121-0524-the-small-vscode-main-fixes/plan.md
  - plans/host/20261121-0554-session-tools-take-model-options/plan.md
  - plans/host/20261121-0555-the-host-watches-its-clients-and-stays-awake/plan.md
  - plans/host/20261121-0821-an-automation-runs-once-at-a-set-time/plan.md
  - plans/host/20261121-0821-an-automation-continues-a-session-or-a-chat/plan.md
  - plans/claude/20261121-1054-a-claude-question-takes-a-typed-answer/plan.md
  - plans/host/20261121-1218-worktree-removals-are-a-queue/plan.md
  - plans/host/20261121-1553-turn-changesets-under-the-chat/plan.md
  - plans/host/20261121-1907-a-client-measures-a-worktrees-disk-usage/plan.md
  - plans/host/20261121-1907-a-single-chat-session-moves-under-another/plan.md
---

# Check the VS Code main parity in VS Code, ahpw and rpc

These are the plans of the VS Code main parity, built on 2026-11-21. The window makes the sessions, ahpw makes the automations, and `rpc` asks the host each method.

Not here: Create PR's push to the remote VS Code chooses needs a GitHub fork, and `chatResources` has no window step yet.

## Set up

1. Start the test daemon in a new shell:

   ```bash
   source <(git -C /github/ahpd fetch -q origin && git -C /github/ahpd show origin/main:.project/pending/test-daemon.sh) agent-claude
   ```

2. Add the entry the script prints to `chat.remoteAgentHosts` in VS Code's `settings.json`, set `"chat.remoteAgentHostsEnabled": true`, and reload the window.
3. In the same shell, set the two names the steps use:

   ```bash
   W="file://$HOME/ahpd-check/work"
   T="$HOME/ahpd-check/work.worktrees"
   ```

4. Turn chat moves on:

   ```bash
   rpc dispatchAction '{"channel":"ahp-root://","clientSeq":1,"action":{"type":"root/configChanged","config":{"chatMoves.enabled":true}}}'
   ```

   Pass: `ANSWER` with no `error`.

## 1. A worktree's disk usage (#428)

1. Run `rpc vscode/measureWorktreeDiskUsage "{\"uri\":\"$W\",\"requestId\":\"one\"}"`.
   Pass: `ANSWER {"sizeBytes":<n>}`, with `<n>` a little below what `du -s -B1 ~/ahpd-check/work` prints. `du` also counts the folders themselves.
2. Run `rpc vscode/measureWorktreeDiskUsage '{"uri":"ahp-session:/x","requestId":"two"}'`.
   Pass: an `error` with the message `uri must be an absolute file URI`.
3. Run `rpc vscode/measureWorktreeDiskUsage "{\"uri\":\"$W/no-such-folder\",\"requestId\":\"three\"}"`.
   Pass: `ANSWER {}`.

## 2. An archived session's worktree cleanup (#418)

1. In the window, start a Claude session on `ahpd-check` in `work`, with isolation set to "worktree".
2. Send: `Create the file note.txt with the word hello, and do not commit it.` Wait for the turn to end.
3. Archive the session in the window.
4. Run `rpc listSessions '{}'`, and copy the session's `resource` into `S`: `S='<resource>'`.
5. Run `rpc vscode/sessionWorktreeCleanup "{\"session\":\"$S\"}"`.
   Pass: `ANSWER {"state":"skipped","message":"it has changes nobody committed"}`.
   `{"state":"inUse"}` means the host still runs the session: write it down, close the session in the window, and run the step again.
6. Run `rpc vscode/sessionWorktreeCleanup "{\"session\":\"$S\",\"force\":true}"`.
   Pass: an `error` with the message `Forced cleanup requires an explicit retry.`
7. Run `rpc vscode/sessionWorktreeCleanup "{\"session\":\"$S\",\"retry\":true,\"force\":true}"`.
   Pass: `ANSWER {"state":"unknown"}`, and `ls "$T"` no longer lists the session's tree.
8. Run `git -C ~/ahpd-check/work branch --list 'agents/*'`.
   Pass: the session's branch is still listed.

## 3. Managed worktrees (#418)

1. Make a worktree no session holds:

   ```bash
   git -C ~/ahpd-check/work worktree add -q -b agents/orphan "$T/orphan"
   ```

2. Run `rpc vscode/listManagedWorktrees "{\"repositories\":[\"$W\"]}"`.
   Pass: an entry with `"branch":"agents/orphan"` and `"cleanupStatus":{"state":"unknown"}`.
3. Run `rpc vscode/cleanupManagedWorktree "{\"repository\":\"$W\",\"worktree\":\"file://$T/orphan\",\"branch\":\"agents/orphan\",\"force\":true}"`.
   Pass: `ANSWER {}`, `ls "$T"` no longer lists `orphan`, and `git -C ~/ahpd-check/work branch --list agents/orphan` still lists the branch.

## 4. A session moves under another (#429)

1. In the window, start two Claude sessions on `ahpd-check` in `work`, and send `Say hello.` in each. Wait for both turns to end, and keep both open: the host moves only a session it runs.
2. Run `rpc listSessions '{}'`, and copy the two `resource` values: `A='<first>'` and `B='<second>'`.
3. Run `rpc subscribe "{\"channel\":\"$A\"}"`.
   Pass: the answer's `_meta` has `"vscode.movable":true`.
4. Run `rpc vscode/moveSession "{\"session\":\"$A\",\"destination\":\"$A\",\"after\":null}"`.
   Pass: an `error` with the message `A session can't move under itself.`
5. Run `rpc vscode/moveSession "{\"session\":\"$A\",\"destination\":\"$B\",\"after\":null}"`.
   Pass: `ANSWER {"session":"<B>"}`.
6. In the window, check that session A is gone from the list.
   Pass: session B shows A's chat as a second chat, with A's turn in it.

## 5. A chat's own changesets (#419)

1. In session B of section 4, open the chat that moved in from A, and send: `Create the file moved.txt with the word hi.` Wait for the turn to end.
2. Run `rpc listSessions '{}'`, then run `rpc subscribe "{\"channel\":\"$B\"}"`, and copy the moved chat's `resource` from its `chats` into `C`: `C='<chat>'`.
3. Run `rpc subscribe "{\"channel\":\"$C\"}"`.
   Pass: its `changesets` list `uriTemplate` values that start with the chat's own URI, ending in `/changeset/uncommitted` and `/changeset/turn/{turnId}`, and none ending in `/changeset/session`.
4. In the window, open the moved chat's changes.
   Pass: the change picker offers "This Turn", and it shows `moved.txt`.

## 6. An MCP permission rule (host/20261121-0524)

1. Deny every MCP call:

   ```bash
   rpc dispatchAction '{"channel":"ahp-root://","clientSeq":2,"action":{"type":"root/configChanged","config":{"permissions":{"allow":[],"deny":["Mcp"]}}}}'
   ```

2. In the window, start a Claude session on `ahpd-check`, and send: `Call one of your MCP tools, such as list_sessions, and tell me what it answered.`
   Pass: the call is refused, and Claude says it was denied.
3. Allow MCP calls again:

   ```bash
   rpc dispatchAction '{"channel":"ahp-root://","clientSeq":3,"action":{"type":"root/configChanged","config":{"permissions":{"allow":[],"deny":[]}}}}'
   ```

## 7. A new session takes model options (#400)

1. Turn the model options on: `rpc dispatchAction '{"channel":"ahp-root://","clientSeq":4,"action":{"type":"root/configChanged","config":{"sessionModelOptions":"tool"}}}'`.
2. In the window, start a Claude session on `ahpd-check`, and send: `Call list_models, and tell me the reasoning effort values your model offers.`
   Pass: Claude names the values, such as `low`, `medium` and `high`.
3. Send: `Use create_session to start a Claude session in this folder with reasoningEffort low, and the prompt "Say hi."`
   Pass: a new session shows in the window's list. Write down the effort its model picker shows: it should be low.

## 8. A silent client is closed (#401)

1. Run `ALL=1 rpc listSessions '{}' 40000`. `rpc` answers no request of the host.
   Pass: after about 10 s a `NOTE` with `"method":"ping"` is printed, and about 20 s later `CLOSED`.

## 9. The machine stays awake while a turn runs (#401)

1. Hold sleep in any power state: `rpc dispatchAction '{"channel":"ahp-root://","clientSeq":5,"action":{"type":"root/configChanged","config":{"keepAwakeWhileWorking":"always"}}}'`.
2. In the window, send a Claude session on `ahpd-check`: `Run sleep 60 in the shell, then say done.`
3. While the turn runs, run `systemd-inhibit --list`.
   Pass: a row with who `ahpd`, why `An agent is working`, what `idle` and mode `block`.
4. Run `systemd-inhibit --list` again 3 minutes after the turn ended.
   Pass: the `ahpd` row is gone. The host lets go 2 minutes after the last turn.

## 10. A Claude question takes a typed answer (#409)

1. In the window, send a Claude session on `ahpd-check`: `Use AskUserQuestion to ask me which color I like, with the options red and blue.`
   Pass: the question offers red, blue, and a field to type an answer of your own.
2. Type `green` in that field, and send it.
   Pass: Claude's reply names green.

## 11. An automation runs once (#404)

1. Start ahpw from its main, on the test daemon:

   ```bash
   git -C /github/ahpw fetch -q origin
   git -C /github/ahpw worktree add -q --detach /github/ahpw.worktrees/parity-check origin/main
   cd /github/ahpw.worktrees/parity-check && pnpm install --frozen-lockfile
   AHPD_URL=http://127.0.0.1:39200 npx vite --port 5191 --strictPort
   ```

2. Open `http://127.0.0.1:5191`, and sign in with `check-token`.
3. Make an automation of Claude on `work`. Under *Schedule* pick "Once, at a set time", set *Runs at* 3 minutes from now, and create it.
   Pass: the list shows "Once at" and that time.
4. Wait until the time has passed.
   Pass: one run is listed, and opening the automation says "This automation already ran once, so it can't be changed."

## 12. An automation continues one chat (#406)

1. Open a Claude session on `ahpd-check` in the window, and send `Say hello.`
2. In ahpw, make an automation of Claude on `work`. Under *Where each run goes* pick "In one chat", pick that session's chat, and set the schedule to "Every 10 minutes".
3. Press Run on the automation.
   Pass: the run's message comes as a new turn of that chat, in the window.
4. Send a long turn in the chat, such as `Run sleep 60 in the shell, then say done.`, and press Run again while it runs.
   Pass: the run's message waits in the chat's queue, and starts after the long turn ends. It does not steer the turn.

## Reply

Write "pass" for each section, or what you saw. Stop the test daemon with `ahpd stop`.
