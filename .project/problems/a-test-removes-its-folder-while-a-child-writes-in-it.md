---
title: A test removes its folder while a child process still writes in it
status: open
date: 2026-10-18
severity: minor
refs:
  - "[code://packages/agent-acp/test/agent-acp-ports.test.ts#L87-L95](../../packages/agent-acp/test/agent-acp-ports.test.ts#L87-L95) - the teardown that failed in the policy/02 gates"
  - "[code://packages/server/test/server-cli-service.test.ts](../../packages/server/test/server-cli-service.test.ts) - the test that failed on CI"
  - https://github.com/softov/ahpd/actions/runs/39122204393 - the CI run that failed and then passed on a second run
---

## Symptom

`rmSync(path, { recursive: true, force: true })` fails with `ENOTEMPTY` in a test teardown.
On 2026-10-18 it failed `service install > names a relative configuration file in full` on CI for `61dbaeea`.
On the same day it failed `answers with the option the person picked, and says which` in the policy/02 gates.
Both tests pass when they run again, and the ACP test passes three times out of three alone.
On 2026-11-21 CI's `windows (3/4)` on #429, run 44942705209, failed `computer-disposable.test.ts`: `lets the machine go when the session moves to this host at its first send, and keeps it when it asks for the same profile again before that send` with `ENOTEMPTY` on its temporary folder. That teardown already ends the holders first. #429 does not change `packages/computer`.
On 2026-11-21 CI's `windows (3/4)` on #426, run 44941762575, failed `takes the machine's own git volume with it, and asks for none where the profile leaves it open` in the same file, with the same error.
On 2026-11-21 CI's `windows (3/4)` on #425, run 44943828564, failed both of those cases with the same error. Neither PR changes `packages/computer`.
On 2026-11-22 CI's `windows (3/4)` on #435, run 44989360191, failed `takes the machine's own git volume with it, and asks for none where the profile leaves it open` with the same error. #435 does not change `packages/computer`.

## Cause

Unknown.
The likely cause is a child process that writes a file in the folder after the teardown starts to remove it.
The ACP teardown waits for one line in `requests.jsonl`, but not for the fake agent to exit.

The nested-process and disposable teardowns end every process whose environment names their folder before they remove it, with `endHolders` in `tools/holders.ts`. The ACP and service-install teardowns are not changed, and can do the same.

On Windows there is no `/proc`, so `endHolders` found no holder there, and the computer-disposable sightings of 2026-11-21 and 2026-11-22 are all `windows (3/4)`. Since `test/a-fake-docker-is-ended-on-windows`, the fake `docker` keeps a mark under `<tmpdir>/ahpd-test-holders/` while it runs, and `endHolders` ends a process by its mark on every platform.
On 2026-11-22 CI's `windows (3/4)` on #439, run 44995032529, failed `takes the machine's own git volume with it, and asks for none where the profile leaves it open` again, with the marks in place. So the writer is not only the fake `docker`.
Each `git commit` and `git fetch` starts a detached `git maintenance run --auto` in its repository, as `GIT_TRACE=1` shows with git 2.47.3. That process has no mark, and its environment names no test folder, so `endHolders` cannot find it. The computer-disposable cases commit and fetch in a repository inside the folder they remove.
Since #440, `tools/test-tmpdir.ts` sets `maintenance.auto=false` and `gc.auto=0` for every git a test starts.
On 2026-11-22 CI's `windows (3/4)` on #439, run on `5e20b12c6` with #440 in, failed the same case with the same error. So git's background maintenance is not the writer, or not the only one.
The failed case took 9.4 s, and its removal tries again for 5.5 s. So the folder holds a file for seconds after the teardown starts, and not only for a moment.
Since `test/a-failed-removal-names-what-is-left`, the disposable teardown removes its folders with `removeFolder` in `tools/holders.ts`. A removal that fails names the files still in the folder and the holders still seen.
On 2026-11-22 CI's `windows (3/4)` on #443, run 45003389117, failed the same case again. It said `Still in it: docker.json. Holders: none.` So the file left is the fake `docker`'s state, and no call of it was alive at the check.
Either a call wrote the state again after the removal deleted it and ended before the check, or something else held the file open. Since `test/a-left-docker-state-names-its-last-call`, the message also gives each file's age and the last three calls that the state records.
On 2026-11-22 CI's `windows (3/4)` on #446, run 45050213305, failed the same case. It said `Still in it: docker.json written 5524ms ago (last calls: volume ls --format). Holders: none.`
The removal tries again for 5.5 s, so the state was written when the removal started. The last call was `docker volume ls`, and no call was alive at the check.
That call is the part-volume sweep, which starts 30 s after the plugin starts. The case moves its fake clock 1 s for each 5 ms of real time, so a slow run passes 30 s. The close cleared the sweep's timer, but did not wait for a sweep that had started.
Since `computer/a-close-waits-for-the-part-volume-sweep`, the close waits for it.

## Impact

A full test run fails at random, so a red CI run or gate run needs a second run before it says anything.

## Workaround

None. Running the job again is not a fix.

## Fix

End the processes that name the folder with `endHolders` before the removal, as the nested-process teardown does.
Or wait for the child process to exit before the teardown removes its folder.
Or retry the removal with `maxRetries` and `retryDelay`, which `rmSync` takes for this error.
