---
title: "Handoff: where ahpd stands, and what is pending"
---

# Handoff: where `ahpd` stands, and what is pending

Current progress and pending items only, as of 2026-11-25. *Outside this repository* was last checked on 2026-11-04.
`node ~/.claude/skills/do-spec/scripts/plans.mjs` lists the backlog, and each plan's Resume state is its detail. What merged is in `git log`, and what was released is in [docs/updates/](../../docs/updates/).

## Main

- **2026-11-25.** #476 (`e06dbc28f`) merged on Softov's word, green: a registered channel offers operations. It starts again from beorn's commit in #474.
  - #474 shows as merged on GitHub and is not in main. Main was forced back to `c60e02019` on Softov's word, because the second commit on it, `66e1dcb04`, was wrong about kinds.
  - beorn has not been told of #476. Their `caller` argument for `run`, beorn/ahpd#36, is not in it. Whether it joins 0.16 is open.
- **2026-11-24.** The six plans for the rest of AHP 1.1.0 are built, and each plan waits for Softov's review to be `built`:
  - Merged on his word of 2026-11-24, green: #456 (`8a2109753`, small wire items), #457 (`36dcfbc45`, changeset editing and nonces), #458 (`b65fd7407`, reasoning times), #459 (`cc8d19915`, a chat's own agent), #460 (`925cc1f5f`, `chat/moved`) and #461 (`afbbae125`, MCP skills). His dev daemon takes #446 to #461 at its next restart.
  - cofold #12 (`cb40b7c`), #13 (`5332aaa`) and #14 (`b1288d3`) are merged, and the tag `release-2026-11-24` released `@cofold/agents@0.4.1` and `@cofold/mcp-client@0.2.0`. npm serves both since 2026-11-24, and #461 takes both.
  - [pending/ahp-1-1-checks.md](../pending/ahp-1-1-checks.md) is the check of the six plans, as a script. It found that #461 shows no skills for a server that is still connecting at the handshake. #464 (`2dfddc7a4`) fixes it, and with it every line passes. His dev daemon takes #446 to #469 at its next restart.
  - Left for 0.16, reviewed with Softov on 2026-11-24: [the bot and push writes](../plans/plugin/20261124-2310-bots-and-push-change-by-commands-only/plan.md) and [the sandboxed Bash setting](../plans/claude/20261124-2310-sandboxed-bash-asks-by-default/plan.md) are built on his word, the first as #467 (`53a82b3cb`) and the second as #466 (`4835cdfab`), the kind commands brief is for 0.17 maybe (Softov, 2026-11-25), [the ahpd part](../plans/container/20261125-0130-the-ahpd-part-is-the-releases-own/plan.md) and [the copy to a box](../plans/container/20261125-0131-a-box-with-no-internet-gets-a-copy/plan.md) are built on his word of 2026-11-25 and merged green as #468 (`d727e214d`, with the dry run 45533551795 of `release.yml`) and #469 (`f20579ded`). Each waits for its check in `.project/pending/` and his review. #468 also installs the sandbox runtime's tools in the release job, without which any 0.16 tag run fails. And `v0_16.md` is written and merged as #470 (`80bb1f2ee`), with its date and version heading to set at the tag. The lost Claude turn does not block it.
  - Not built: `resultMetadata` after a restart, a skill's toggle after a daemon restart, and times from ACP and for pi's end.
- **2026-11-22.** All nine `20261121-2250` builds that could be built are merged, and are `built` on Softov's word of 2026-11-23.
  - #431 (`ec0876a52`) chat workspace, #432 (`7661f184a`) automation deletion, #433 (`b7623c608`) shell authentication, #434 (`a27918599`) session from a conversation, #435 (`3f1db3491`) MCP sign-in, #438 (`4d64a4b40`) turn timing.
  - #439 (`279b4195c`) nested chat changesets, #436 (`d47f32841`) dev container from an image, #442 (`cb3ab56e0`) session import, #443 (`8b08e5a5e`) user state and the container sandbox. The served count is 70.
  - Test fixes: #437, #440, #441, #444 (`0b8c806a8`, changes-refresh closes its hosts) and #445 (`977d480fe`).
  - The computer-disposable `ENOTEMPTY` on Windows is still open: [the problem](../problems/a-test-removes-its-folder-while-a-child-writes-in-it.md) has every sighting. Since #445 a failed removal names each left file's age and the fake `docker`'s last calls. A new problem: [a bring-back case sees another file's scratch folder](../problems/a-bring-back-case-sees-another-files-scratch-folder.md).
  - npm serves `@ahpio/sandbox-runtime@0.0.83-rc.0` under `next`, published by the fork's `release.yml`. The fork's upstream passes are in its `UPSTREAM.md`.
  - npm serves `@ahpio/sandbox-runtime@0.0.83` under `latest`, from release `ahpio-v0.0.83` (run 45269769470) on `77737fd1d`. Fork PR #2 tags fork releases `ahpio-v<version>` and checks the package name; it merged with only macOS arm64 red, a runner GitHub never gave. #455 (`8378a5898`) pins the computer plugin to it.
  - #446 (`9bc2c07d4`): the computer plugin runs on the fork, and the tree loads one zod, 4.6.7. The fork plan is `built` on Softov's word. The CA plan is revised to VS Code's meaning and parked until a feature turns termination on: [briefs/a-machine-never-holds-the-git-token.md](../briefs/a-machine-never-holds-the-git-token.md). On Ubuntu 26.04 the host check says the AppArmor profile `bwrap-userns-restrict` stops the runtime, and names the commands that unload it; CI unloads it.
  - #447 (`72130ccd8`): a close waits for the part-volume sweep, the likely writer in the disposable `ENOTEMPTY`. The problem stays open until CI shows the error has stopped.
  - #449 (`300e5eb60`): the ACP machine cases import the computer plugin before their budget. The first case took 9.3 s on Windows, down from 15 s to 17 s.
  - #448 (`d27af6933`): a host the runtime cannot start on says why, and on Ubuntu 26.04 names the AppArmor profile and the commands that unload it. CI's `processes` job is back on `ubuntu-latest`.
  - Softov's dev daemon takes #446, #447 and #448 at its next restart on main.
  - Briefs under review with Softov: [plugins-are-a-sessions-extensions.md](../briefs/plugins-are-a-sessions-extensions.md), an agent builds an app that lasts, and [a-todo-app-is-the-first-agent-app.md](../briefs/a-todo-app-is-the-first-agent-app.md), the first app with what it misses. [a-crm-is-the-second-example-kind.md](../briefs/a-crm-is-the-second-example-kind.md) checks the host parts against a CRM, and its open points are answered. Plan 2 waits for his word to plan it.
  - The six problems that waited for 0.16 were answered on 2026-11-23. Four plans `20261123-0945` fix five of them: bots/each-bot-chat-keeps-its-own-log, host/a-sessions-changes-have-one-key, container/a-busy-dev-container-is-not-stopped and bots/a-bot-owner-edited-by-hand-is-logged. The lost Claude turn stays open.
  - Built on 2026-11-23. Merged on Softov's word: #451 (`e44f3e89a`, bot chat log), #453 (`892838e2b`, busy dev container) and #454 (`d658c3ed4`, bot owner). #452 (`4115c6de5`, changes key) merged after a test fix. The four plans are `built` on Softov's word. His dev daemon takes #451 to #454 at its next restart.
  - Softov restarted his dev daemon on main with #431 to #445.
- **2026-11-21.** 0.15.0 is released: `v0.15.0` is on `3bf557618` (#394), and npm serves the 13 packages under `latest`. `ghcr.io/ahpio/ahpd` has `0.15.0`, `0.15` and `latest`. ahpw `v0.9.0` is on `d968e1f`, with `@ahpd/web` under `latest`. [pending/release.md](../pending/release.md) is closed.
  - Merged on 2026-11-21: #393 (`bcec57901`) from beorn, #395 (`9ad9b0f98`), #396 (`2bb0f809e`) and #398 (`98a2b4cd7`), the image fix.
  - 46 plans went to `built` with the release as their review (`88251f665`).
  - The VS Code main parity is built. Ten of its plans closed as `built` on Softov's word in `bc9e0a4e0`:
    - host/117 (#397), host/20261121-0524 (#399), host/20261121-0554 (#400) and host/20261121-0555 (#401);
    - both host/20261121-0821 plans (#404, #406), and claude/20261121-1054 (#409);
    - host/20261121-1218 (#418), host/20261121-1553 (#419) and plugin/20261121-1708 (#422).
  - #428 (`19b9b1a3d`) merged [host/20261121-1907-a-client-measures-a-worktrees-disk-usage](../plans/host/20261121-1907-a-client-measures-a-worktrees-disk-usage/plan.md), and #429 (`567d641b6`) merged [host/20261121-1907-a-single-chat-session-moves-under-another](../plans/host/20261121-1907-a-single-chat-session-moves-under-another/plan.md). Both are `built` on Softov's word of 2026-11-23.
  - #429's check-windows was red twice on cases it does not touch. The causes are problem files, and one rerun of the failed jobs passed on Softov's yes.
  - Also merged: #402 (`2360a50aa`), Create PR on a fork, and #420 (`2f61bd9df`), the budgets of three random cases.
  - In ahpw: #109 (`c440209`) reads a canvas's `uri`, and #112 (`4da31ba`) adds the one-time trigger and the target to the automation form.
  - [pending/vscode-main-parity-checks.md](../pending/vscode-main-parity-checks.md) is the check by hand of the parity, 12 sections in VS Code, ahpw and `rpc`.
  - Softov's dev daemon takes #401, #418, #419, #422, #428 and #429 at its next restart on main. Tell him, and do not restart it.
  - Eleven plans `20261121-2250` cover the groups of [briefs/vscode-methods-ahpd-does-not-serve.md](../briefs/vscode-methods-ahpd-does-not-serve.md), which links each one in *The change*. A review's fixes are in them. Their builds run on `claude-deepseek-build`, on Softov's choice.
    - The host plans all add to `vscodemethods.ts`, `gate.ts`, `handshake.ts` and the gate table test, so their builds stack.
    - Builds run on `claude-deepseek-build` through the MCP tools. Its allow-list denies `git fetch`, `git merge` and any vitest wrapped in `flock`, even after the lock rules went into `agents/claude-deepseek-build.json` and a daemon restart. So builders write code and run `pnpm typecheck` and `pnpm boundary`, and I run every suite under the lock with `TMPDIR`.
    - After the restart, `list_sessions` left out two build sessions, and one came back with an empty transcript; their records were on disk. New sessions continue them in the same worktrees: `6220aef8` for automation deletion, `b2ef79ab` for chat workspace.
    - `container/20261121-2250-the-sandbox-runtime-is-ahpios-fork` replaces the sandbox runtime brief. The fork `ahpio/sandbox-runtime` exists on his yes, default branch `ahpio` at `v0.0.83`, cloned to `/github/sandbox-runtime`. Its first release is `0.0.83-rc.0`, and the first npm publish is his.
  - Three briefs keep Softov's intent: [agent-extensions-are-a-sessions-plugins.md](../briefs/agent-extensions-are-a-sessions-plugins.md), [plugins-are-a-sessions-extensions.md](../briefs/plugins-are-a-sessions-extensions.md) and [artifact-integrations.md](../briefs/artifact-integrations.md). Their open points wait for Softov's answers. The plugin brief is not yet what he wants: an app made in one session lasts, and other sessions change it.
  - Agent extensions and artifact integrations get briefs of their own.
  - [pending/ahp-1-2-0-package.md](../pending/ahp-1-2-0-package.md) waits for AHP 1.2.0 on npm, to drop the local 1.2.0 types.
  - `/github/ahpd` is on `briefs/record-edits`, whose one commit is on main as `c4516b3b0`. The branch can go on Softov's word. Its local `main` matches `origin/main`.
- Before 0.15.0, the last stable release was 0.14.0 (`v0.14.0`). `v0.15.0-rc.3` is tagged on `28dd315e0` (#320). Its release run 43394827388 passed `parts`, `release` and `image` on 2026-11-13, and staged the 13 packages under `next`. Softov approved them on 2026-11-13, and npm serves `0.15.0-rc.3` under `next` since 14:36 UTC. What the release needs is in [pending/release.md](../pending/release.md), and the checks by hand are ordered in [pending/triage.md](../pending/triage.md).
- The rc.4 bump #376 merged as `e5776651c` on 2026-11-18, after dry run 44258114344 passed `parts`, `release` and `image`. Its PR's `image` failed only because npm did not serve `@ahpd/sdk@0.15.0-rc.4` yet, as at rc.3. `v0.15.0-rc.4` is tagged on `e5776651c` on Softov's word, and release run 44267371516 is running. Before it, #374 (`b33bd3021`) and #375 (`9bd158ebd`) merged on 2026-11-18: daemon/20261118-0603 and host/20261118-0603. Before them, #373 (`fadc39469`) on 2026-11-18, task 03 of daemon/20261118-0129: configure reads its paths from the configuration folder. Before it, #372 (`f718cd99f`) on 2026-11-18, daemon/20261118-0129, configure sets up policies and people. Before that, #371 (`a3b0b01a2`) on 2026-11-17, host/20261117-2336, a test's own git call says where it stalled. Before that, #370 (`bf25d35b9`), a follow-up to host/20261117-2149: the slow-git cases print nothing. Before that, #369 (`08a1c1d9d`), host/20261117-2149, the Windows git cases. Before that, #368 (`1aab4e4da`), plugin/20261117-2030, a deleted Dev Tunnel made again. Before that, #367 (`7334b1464`), host/20261117-1047, the approval settings kept per person. Before that, #366 (`a00a79916`), host/20261117-0842, an adopted session kept with its owner. Before that, #364 (`d55de8382`) and #365 (`0677627e0`), the two tunnel plans. Before them, #363 (`cdc16cabf`), host/20261117-0525, a wrapper command read through. Before it, #360, #361 and #362 (`3d753db39`) on 2026-11-16, the three security plans below. Before them, #357 (`4a5108286`), host/20261116-1714, the pull request details. Before it, #355 (`2fa19f87f`), plugin/20261116-1816, and before that #351 (`d5a75c2c2`) on 2026-11-15. Five test fixes merged that day: #350 to #354. #348 (`74a5d756a`) merged before them, from another session: the sandbox schema names every value. Before it came #345 (`c28d0a4f6`), the model gateway rename. The fix of a Windows case, #347 (`4d3d3adf5`), merged before that. Earlier, #343 (`804a23937`) and #341 (`7bc308a23`) merged from another session. Before it, #342 (`eb94c97a6`) gave the cases of `host-permissions.test.ts` a home of their own. A `TMPDIR` under a home dot folder no longer fails two of them. Before it, #339 (`a01d874cb`) made the daemon read the plugin list. Before #339, the merge of #340 (`4b4700f3f`) fixed two random cases in tests only. Earlier that day, #338 (`9863785ca`) merged. On 2026-11-14, #329, #332, #331, #333, #335, #336 and #337 merged. On 2026-11-13, #321 to #328 merged after the rc.3 release.
- #384 (`05fa09ecf`) merged on 2026-11-19: [plugin/20261119-0328-an-emptied-field-is-not-set](../plans/plugin/20261119-0328-an-emptied-field-is-not-set/plan.md). It is `built`: Softov's check in ahpw passed on 2026-11-19. #385 (`f926befca`), plugin/20261119-0543, is `built` on his word, and its checks by hand wait in its `deferred.md`. Softov's working day on main runs since 2026-11-19. ahpw #103 and #104 and ahpc #41 merged the same day. #386 (`69571e844`), plugin/20261119-2339, merged that day too: a bot talk the host cannot open is no talk, through the new `host.sessionOpens`. #387 (`b44c3e520`) follows it: a talk is a session the store keeps with its config and the host can open, after #386 took Ember's old log as Softov's talk. #388 (`8cb8946fd`) fixed the cofold truncation case that failed #387's first Windows run. The plan is `built`: Ember worked after Softov's restart on 2026-11-19. ahpw #102 (`9603ada`) sets the sdk peer to `>=0.15.0-rc.2`, merged on 2026-11-19, item 2 of [pending/release.md](../pending/release.md#left).
- [plugin/20261119-0543-agent-settings-follow-one-order](../plans/plugin/20261119-0543-agent-settings-follow-one-order/plan.md) is merged in #385 (`f926befca`) on 2026-11-19. It closes after Softov's checks, once the dev daemon restarts on main.
- plugin/20261114-1455 waits for Softov's review to close.
- [proxy/20261115-1352-the-model-proxy-is-the-model-gateway](../plans/proxy/20261115-1352-the-model-proxy-is-the-model-gateway/plan.md) is merged in #345, and ahpw's `hosts/20261115-1356-the-model-gateway-section` in ahpw #92 (`113d3feaa`). Both close on Softov's word. No old name is read: a daemon restarted on main ignores `modelProxy` with a warning. The rc.4 bump waits for Softov's word (2026-11-15).
- [claude/20261114-1816-the-context-figure-follows-a-long-turn](../plans/claude/20261114-1816-the-context-figure-follows-a-long-turn/plan.md) is merged in #331, and closes on Softov's word. #331 also fixes the plugin turn case that waited a fixed 20 ms.
- The brief [vs-code-shows-the-claude-context-figure.md](../briefs/vs-code-shows-the-claude-context-figure.md) waits for "plan it".
- [claude/20261115-0157-the-history-reads-across-compactions](../plans/claude/20261115-0157-the-history-reads-across-compactions/plan.md) is merged in #338, and closes on Softov's word. After a restart, a Claude session shows its turns before each compaction again, and draws each compaction notice. The test daemon check passed at `9863785ca`.
- [plugin/20261113-2029-the-daemon-reads-the-plugin-list](../plans/plugin/20261113-2029-the-daemon-reads-the-plugin-list/plan.md) is merged in #339, with four tasks `implemented`, and waits for Softov's review. The daemon reads `pluginMarketplaces`, answers `x-ahpd/plugins/available` and `details`, and installs a listed version. `details` with `installed: true` answers the README, changelog and license of the installed package. Its `linux (2/2)` failed once in the cofold truncation case, and passed on one rerun after #340. The list at `https://plugins.ahpio.com/v1/plugins.json` holds 12 plugins on 2026-11-15.
- The pull request card is merged on 2026-11-16: ahpd #357 (`4a5108286`) and ahpw #98 (`7ec5aed5e`), both green on the first attempt. Both plans close on Softov's word, after the check by hand on the test daemon. Softov approved the mockup with plain text, no avatar, no extra link, four state icons and today's `/session.pr` flow. The plans are [host/20261116-1714-each-pull-request-carries-githubs-details](../plans/host/20261116-1714-each-pull-request-carries-githubs-details/plan.md) here, and ahpw's `sessions/20261116-1714-the-pull-request-card-shows-github`. Each pull request a session shows carries what GitHub says of it under `_meta['ahpd.pullRequests']`. It covers the merged pull request that stayed unmerged in a session's list.
- The upgrade break is planned on 2026-11-16, and must merge before rc.4: [plugin/20261116-1816-plugins-follow-the-sdk](../plans/plugin/20261116-1816-plugins-follow-the-sdk/plan.md), 4 tasks. The upgrade check of 2026-11-16 found that the 0.14.0 backends do not import on sdk 0.15. A plugin is checked against the sdk the daemon ships. A prerelease sdk takes the plugin prereleases that a range admits. Each release sets the plugins' range from its sdk to the next minor.
  - It requires ahpio-site's `plugins/20261116-1816-the-list-serves-prereleases` (1 task), since the list serves releases only. Its deploy is Softov's step.
  - Softov chose on 2026-11-16 that this session builds both. The ahpd build is merged in #355 (`2fa19f87f`), green on the first attempt, and the plan closes on his word. The ahpio-site build is on its main as `3aae9f7`. Softov's deploy of 2026-11-16 ran before `/github/ahpio-site` held it, and the 20:17 UTC run served no prerelease, so it waits for a deploy again. The server, sdk and computer suites pass on the ahpd branch.
  - Found in the build: [a-dev-container-installs-the-server-at-the-sdks-version.md](../problems/a-dev-container-installs-the-server-at-the-sdks-version.md).
- The four multi-user security problems of 2026-11-08 reproduce on the test daemon at `2228ec5af`, on 2026-11-16. Each problem file's *Symptom* holds the steps and what was not tried. Softov chose on 2026-11-16 to fix all four for 0.15, problem 4 with rules per person, which needs `a-claude-session-from-vs-code-has-no-owner.md` first.
  - Problems 1 to 3 are merged on 2026-11-16. Each plan has every task `implemented`. Each waits for Softov's review and the checks of its *Final verification checklist*:
    - #360 (`9018eba72`): [host/20261116-2126-approvals-follow-the-sessions-owner](../plans/host/20261116-2126-approvals-follow-the-sessions-owner/plan.md), with `unattendedAutoApprove` on by default.
    - #361 (`64639616d`): [host/20261116-2128-backends-ask-what-the-operator-asks](../plans/host/20261116-2128-backends-ask-what-the-operator-asks/plan.md).
    - #362 (`3d753db39`): [host/20261116-2134-always-allow-has-a-level-per-person](../plans/host/20261116-2134-always-allow-has-a-level-per-person/plan.md). A command the table denies is offered no grant (Softov, 2026-11-16). Its first CI run failed in `agent-acp-rule.test.ts`, and `75ccedcaf` fixed it.
  - #366 (`a00a79916`), merged on 2026-11-17: [host/20261117-0842-an-adopted-session-keeps-its-owner](../plans/host/20261117-0842-an-adopted-session-keeps-its-owner/plan.md). The person whose turn adopts an external session becomes its owner. It waits for Softov's review and its test daemon check. Problem 4 can be planned now: a plan of terminal rules per person, which may share the person store of host/20261116-2134.
  - #363 (`cdc16cabf`), merged on 2026-11-17: [host/20261117-0525-a-wrapper-is-read-through](../plans/host/20261117-0525-a-wrapper-is-read-through/plan.md). Rules and every deny rule judge the command a wrapper runs, and no grant names a wrapper. It waits for Softov's review and the checks of its *Final verification checklist*.
  - #364 (`d55de8382`) and #365 (`0677627e0`), merged on 2026-11-17: [plugin/20261117-0701-anonymous-31546-requires-a-token](../plans/plugin/20261117-0701-anonymous-31546-requires-a-token/plan.md) and [plugin/20261117-0701-a-tunnel-port-is-gated-by-a-token](../plans/plugin/20261117-0701-a-tunnel-port-is-gated-by-a-token/plan.md). Both wait for Softov's review and the checks of their *Final verification checklist*. They cover the problem file `an-anonymous-tunnel-admits-the-derived-token.md`, which was never committed, and Softov had it deleted on 2026-11-17.
  - #369 (`08a1c1d9d`), merged on 2026-11-17: [host/20261117-2149-the-windows-git-cases-stop-flaking](../plans/host/20261117-2149-the-windows-git-cases-stop-flaking/plan.md). Task 01 is dropped. A Windows CI job now prints each git call over 2 s as a `slow git:` line. Its first run printed one line, made by its own test's stood-in clock. #370 (`bf25d35b9`), merged on 2026-11-17, makes those cases unset the variable. Its Windows run printed no `slow git:` line. Its server run failed one restart case at random, which [daemon/20261118-0603-a-stopped-daemon-is-waited-for-20-s](../plans/daemon/20261118-0603-a-stopped-daemon-is-waited-for-20-s/plan.md) fixes.
  - Planned on 2026-11-18, not built: [daemon/20261118-0603-a-stopped-daemon-is-waited-for-20-s](../plans/daemon/20261118-0603-a-stopped-daemon-is-waited-for-20-s/plan.md), 1 task, and [host/20261118-0603-the-orchestration-limits-are-a-host-option](../plans/host/20261118-0603-the-orchestration-limits-are-a-host-option/plan.md), 2 tasks. They fix the restart case and the 51st session case.
  - #371 (`a3b0b01a2`), merged on 2026-11-17: [host/20261117-2336-a-test-git-call-says-where-it-stalled](../plans/host/20261117-2336-a-test-git-call-says-where-it-stalled/plan.md), 2 tasks. A test's own git call gets a timeout and a `slow git:` line, in all 23 test files. Both tasks are `implemented`, and the plan waits for Softov's review. Its CI was green on the first attempt, with no `slow git:` line. The local computer suite failed one known random case that runs no git, now a sighting.
  - #368, merged on 2026-11-17: [plugin/20261117-2030-a-deleted-tunnel-is-made-again](../plans/plugin/20261117-2030-a-deleted-tunnel-is-made-again/plan.md). Its `windows (3/4)` failed once on a worktrees case, now in `git-cases-time-out-on-windows.md`, and passed on one rerun with Softov's yes. The dev daemon's tunnels come back at its next restart on main. Its system tunnel is `anonymous`, so VS Code cannot connect to it since #364.
  - #367 (`7334b1464`), merged on 2026-11-17: problem 4, [host/20261117-1047-approval-settings-are-kept-per-person](../plans/host/20261117-1047-approval-settings-are-kept-per-person/plan.md). All four multi-user security problems are merged. It waits for Softov's review and the test daemon checks.
- The test daemon's `~/ahpd-check` holds users alice, bob, carol and dave, a role `senders`, and `eligibleForAutoApproval` in `config.json`. It is stopped.
- Problems found on 2026-11-14, none with a fix chosen:
  - [stop-refuses-a-run-whose-sessions-run-no-turn.md](../problems/stop-refuses-a-run-whose-sessions-run-no-turn.md): Softov asked for a problem file, not a fix.
  - In ahpw, `the-automation-form-hides-a-model-its-agent-does-not-offer.md` on ahpw main (`7ffec74`).
- Briefs of 2026-11-14 wait: [a-plugin-asks-for-its-grants.md](../briefs/a-plugin-asks-for-its-grants.md), with no plan for now, [a-bot-session-is-made-where-the-bot-is-offered.md](../briefs/a-bot-session-is-made-where-the-bot-is-offered.md) and [plugin-runtimes-external.md](../briefs/plugin-runtimes-external.md).
- The steps after the rc.3 release run are in *rc.3, after its release run* of [pending/release.md](../pending/release.md#left). The run, the digest check, the approval and the ghcr check of the parts of #318 are done: 17 of 17 digests match. Softov made `compclau` again on 2026-11-19, and it worked.
- The staged `@ahpd/computer@0.15.0-rc.3` holds `images/digests.json` with 17 entries, `ahpd-agents` and 16 parts, the first tag run of #315. Its step logs `tar: stdout: write error`, from `grep -q` closing the pipe. That is harmless now, and it turns the check over if the step ever runs under `pipefail`.
- #318 (`de1924b99`) is the parts bump of 2026-11-13, ten parts, the ahpd part to `0.15.0-rc.2`. Actions may not open a PR in `ahpio/ahpd`, so the workflow pushes the branch and the PR is opened by hand.
- #317 (`e338a1c98`): a piece shows its host mark again. Softov accepted the icons and marks on 2026-11-13, the Postgres mark among them.
- #319 (`9b17317d7`): plan container/20261113-0721, a part on a prerelease takes a newer prerelease. The next run of `parts-bump.yml` proposes dsh 0.2.2-rc.1.
- The dev config's `claude` profile names `agents: ["claude"]` since 2026-11-13, in place of its three hand mounts. A machine from it carries the `claude` part.
- The machine `compclau` was made again from it on 2026-11-13, without the `claude` part. rc.3 pushed `claude` 0.106.0 to ghcr. Softov made `compclau` again on 2026-11-19, and it worked.
- #335 moves the computer image's pi part to pi-coding-agent 1.5.2. `parts-bump.mjs` never moves that package, because `versions.json` pins it. The parts bump of 2026-11-13 is #336: ahpd rc.3, claude 0.107.0, copilot 1.0.111, opencode 2.3.0 and dsh 0.2.2-rc.1. Both reach ghcr only when a release pushes the parts.
- The branch `parts-bump-20261113` of #318 is still on origin. While it is there, a second run of `parts-bump.yml` on a 13th fails to push. Deleting it is Softov's call.
- After a parts bump merges, a checkout loads a moved part only after a release pushes it. `parts-publish.mjs --local` builds every part on this host in its place.
- The repository is `ahpio/ahpd` since 2026-11-11 (#290). MayCXC's fork has no work missing from main.
- Code goes through a PR on `ahpio/ahpd`; plan-only commits go to main. Show a PR's text in chat before opening it. Merge with `gh pr merge <n> -R ahpio/ahpd --admin --merge`, only on Softov's word.
- `check` and `check-windows` must both be green before a merge; no ruleset requires them now. A rerun is not the fix for a case that fails at random: each one gets a problem file, to be fixed. `gh run rerun <id> -R ahpio/ahpd --failed` reruns a job.
- `gh pr checks` has no `--json` here, and `gh pr edit` fails. Read a job's log with `gh api repos/ahpio/ahpd/actions/jobs/<id>/logs`, and set a PR body with `gh api repos/ahpio/ahpd/pulls/<n> -X PATCH -F body=@<file>`.

## The dev daemon

- Softov's dev daemon runs from `/github/ahpd` with `~/.config/ahpd/config-dev.json`, on ports 5180 and 37537. It runs from `src`, so a restart is all a merge needs. It needs `DEEPSEEK_API_KEY` in its environment. Never restart it or use its ports yourself.
- Softov restarted it on 2026-11-17 at 17:29 local, from `/github/ahpd` on `bd48ca5e1`. It runs every merge up to #368. Its tunnel plugin made the Dev Tunnel again as `giant-ant-5q89765`, online at 17:30. Check `git -C /github/ahpd log -1` before you ask for a restart.
- On 2026-11-17 near 00:27 local, ahpw's new session form refused a Claude session with `RPC error -32009: no policy allows computer host`. Softov then wrote the `all` agent row and the `cpttest` computer row at 00:41, so sessions start. Reviewed on 2026-11-17: it is the documented check, met for the first time. Before 00:27 every session came from a root connection, which is never checked, and that night ahpw connected as `soft`. With `policies.check` on, a person needs an `agent` row and a `computer` row, and a session that names no computer is checked as `computer host`. From the review, [daemon/20261118-0129-configure-sets-up-policies-and-people](../plans/daemon/20261118-0129-configure-sets-up-policies-and-people/plan.md) is planned on 2026-11-17, 2 tasks. Both tasks are `implemented`, merged in #372 (`f718cd99f`) on 2026-11-18, and the plan waits for Softov's review. Its check on the test daemon passed, and found that `configure` read a relative `users` and `connectionTokenFile` from the current folder. Task 03 fixes it, merged in #373 (`fadc39469`) on 2026-11-18. The first Always Allow "for Me" wrote `Shell(command *)` to `~/.config/ahpd/permissions/soft.json`, and Softov removed it by 2026-11-18. The system tunnel record has `anonymous: false` since then too.
- #345 renames the model proxy to the model gateway. Softov's `config-dev.json` and `config.json` say `modelGateway`, and the `developer` role says `gateway:*`, since 2026-11-15. Each file has a copy beside it ending in `.bak-gateway-20261115-200146`. The daemon on the old code reads no model table from them if it reloads, so it is restarted on main.
- #329 lets a bot talk run with no grants on the bot plugin's entry.
- #331 updates a Claude session's context figure during a turn and after a compaction.
- #333 moves Claude to SDK 0.3.325 and pi to 1.5.2. A Claude session with `sandbox: on` still runs sandboxed Bash without a prompt. claude/20261124-2310-sandboxed-bash-asks-by-default checks that default in 0.16.
- #337 settles an automation run when the host ends its session's first turn, such as on a model the agent does not offer.
- #338 reads a Claude session's turns before each compaction after a restart, and draws each compaction notice.
- #339 reads the plugin lists, and ahpw (from ahpw #86) shows them in the Plugins sidebar.
- #355 picks a plugin's version by the sdk the daemon ships, and on an rc sdk takes the plugin prereleases a range admits.
- #360 gives a session's approvals to its owner's turns alone.
- #361 makes Claude, pi and cofold ask about a tool that `eligibleForAutoApproval` sets `false`.
- #362 splits Always Allow into "for Me" and "for Everyone". A member's older host rules stay in `permissions` in `root-config.json`.
- #357 sends what GitHub says of each pull request a session shows under `_meta['ahpd.pullRequests']`. It reads an open one each minute while a client watches its folder.
- Softov's automation "Test automation" has a run stuck at `running` since 2026-11-14, on the model `opus[1m]`, which Claude no longer offers. A restart fails that run as interrupted. Its model is fixed by a pick in ahpw's form.
- A restart brings the bot talk, bots on a host with no users, and the operations in the client's language.
- It also writes plugin warnings to the daemon's log with a time and a level.
- `/github/ahpd` is a shared checkout. Work in a worktree from `origin/main` under `/github/ahpd.worktrees/`.
- A test daemon for checks: `source .project/pending/test-daemon.sh`, on port 39200, with its token at `~/ahpd-check/token`. Check `ss -ltnp` before you start one, and stop it by pid.

## Tests

- The computer files that start scripted CLIs give each case 20 s, `PROCESS_CASE_MS`: [computer-cases-time-out-on-a-busy-machine.md](../problems/computer-cases-time-out-on-a-busy-machine.md) is `mitigated`.
- The first-party load and plugin id cases get `IMPORT_CASE_MS` since #420.
- Run one vitest suite at a time: `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run <package>`. A fresh worktree needs `pnpm schema` first.
- `packages/sdk/test/fixtures/wire.jsonl` is rewritten by every run. It is not tracked since `8b63fce96`, so there is nothing to restore. Never print it.
- An sdk host change is gated by the computer suite too.
- CI on main is green at `150983cbe` (run 43357606552): `check`, `check-windows` and `image`, the image job after a rerun once npm served `0.15.0-rc.2`.
- After a bump, the `image` job fails until npm serves the new version. Rerun it after the approval.
- `release.yml` runs the whole `pnpm test` under `timeout 1500` before it publishes, so a flaky case can fail a tag run. The suite took 520 s on 2026-11-12.
- A case that fails at random gets a problem file, to be fixed. The CI runs since 2026-11-10 were read on 2026-11-13. A case counts when it failed on main, or passed on a rerun of the same commit.
- With a problem file:
  - `computer-devcontainer.test.ts`: three cases are fixed by container/20261113-2134, the fourth is [a-dev-container-case-waits-on-a-late-docker-call.md](../problems/a-dev-container-case-waits-on-a-late-docker-call.md), and the fifth is [a-dev-container-stop-case-reads-running-after-the-stop.md](../problems/a-dev-container-stop-case-reads-running-after-the-stop.md).
  - The ACP and service-install teardowns: [a-test-removes-its-folder-while-a-child-writes-in-it.md](../problems/a-test-removes-its-folder-while-a-child-writes-in-it.md).
  - `nested-process.test.ts` leaves refs under `refs/agents/` in the repository: [nested-process-cases-write-checkpoints-into-the-repository.md](../problems/nested-process-cases-write-checkpoints-into-the-repository.md).
  - `host-attachments.test.ts`: [two-attachment-cases-time-out-on-windows.md](../problems/two-attachment-cases-time-out-on-windows.md).
  - `computer-servercheck.test.ts` runs without docker or virsh since #396.
  - `container-relay.test.ts` waits up to 15 s for the nested daemon's first answer, in a 20 s case.
  - `computer-disposable.test.ts`: two cases in [a-disposable-machine-case-fails-at-random.md](../problems/a-disposable-machine-case-fails-at-random.md).
  - `host-files.test.ts`: [a-workspace-less-case-removes-its-home-while-a-folder-is-busy.md](../problems/a-workspace-less-case-removes-its-home-while-a-folder-is-busy.md).
  - `changes-refresh.test.ts` and `worktrees.test.ts`: [git-cases-time-out-on-windows.md](../problems/git-cases-time-out-on-windows.md).
  - `computer-far-docker.test.ts`: [a-far-docker-listing-misses-one-profile-on-windows.md](../problems/a-far-docker-listing-misses-one-profile-on-windows.md).
  - `commands.test.ts`: [the-machine-commands-case-times-out-on-windows.md](../problems/the-machine-commands-case-times-out-on-windows.md).
- `tunnel-devtunnel-view.test.ts` "starts no poll when the tunnel stops during its first read" was fixed by #314.
- The CI runs from 2026-11-12 to 2026-11-15 were read on 2026-11-15, every attempt included. Four fixes merged then:
  - #350: the nested-process and disposable teardowns end every process that names their folder.
  - #352: a usage-port case holds one daemon start.
  - #353: the scripted Docker waits on a lock being removed on Windows.
  - #354: the cofold truncation case waits for the writer claim.
- #351 (`d5a75c2c2`) gives the options cases the scripted Docker.
- After #350 to #354, CI on main passed on the first attempt in each of the six runs to `2cf789740` on 2026-11-16.

## Builders

- Builders run as ahpd sessions over the MCP tools, on `claude-deepseek-build`, with a worktree each. The MCP token is uclau's `claude-code-mcp`, in `~/.claude.json`.
- The build preset denies `flock`, `git add`, `git checkout --` and `pnpm typecheck`. A builder runs `pnpm exec tsc -p tsconfig.json --noEmit` and writes tests; the reviewer runs the suites and commits.
- DeepSeek can stop a builder with `402 Insufficient Balance`. The session's jsonl under `~/.claude/projects/-github-ahpd-worktrees-build-agents-<id>/` shows it.
- On 2026-11-14 the ahpd MCP server did not connect (ECONNREFUSED), and Softov chose ahpc for the builds. Session URIs start with `ahp-session:/`.
- `list_agents` drops an agent that failed to open with no reason. `get_session_context` once answered an empty transcript for a session with a finished turn.

## Worktrees and branches

Remove each only on Softov's word.

- On 2026-11-18, on Softov's word, the 11 worktrees on merged branches were removed with their branches. Left: `handoff` and `pending-check`, both in use, and `docs-plan` and `plugin-list-review`, detached and with no changes. `computer-facts-brief` is detached and holds a change that is not committed, so it stays. On 2026-11-19 its brief went to main as `24ba24911`, and `docs-plan`, `plugin-list-review` and `computer-facts-brief` were removed. Left: `handoff`, and `pending-check`, the test daemon's checkout.
- About 60 local branches have no worktree, from plans built before 2026-11-12. `git branch` lists them, and deleting them waits for Softov's word.
- Another session left changes in `/github/ahpd` that are not committed. They are the brief `a-cloudflare-tunnel-publishes-the-daemon.md` and the new brief `the-agents-are-listed-by-provider.md`. Leave them.
- `/github/ahpw` is on `host-refine-ui`, from another session. Its local main is fast-forwarded with `git fetch origin main:main`.
- Loose files in `/github/ahpd.worktrees/` wait for Softov: `test-tmp`, the `union-*.log` files, the `.patch` files, `review-host62.md` and `acp-server.orig.mjs`.

## Plans waiting to close

- On 2026-11-18, the checklists of 12 plans ran on the test daemon and the suites at `2946984b6`. Nine passed in full. On Softov's word they are `built` since 2026-11-18, each with its `implemented.md`: host/20261116-2126, host/20261116-2128, host/20261116-2134, host/20261117-0525, host/20261117-0842, host/20261117-1047, host/20261117-2149, host/20261117-2336 and daemon/20261118-0129. The three tunnel plans, plugin/20261117-0701 (two) and plugin/20261117-2030, passed their checks by hand on 2026-11-18 and are `built`.
Each plan here has every task `implemented`, and closes as `built` on Softov's word after his review.

- The Windows check of 2026-11-12, [results](../pending/windows-machine-paths-checks.md#results-on-windows-2026-11-12): the seven plans of #304 to #310. They close after the Windows check runs again.
- plugin/20261112-0145, three plans: #301, #302 and #303.
- The release run of 2026-11-11: thirteen plans, from #273 to #281, #286 and #293 to #295. They are acp/20261110-0813, cofold/20261110-0813 (two), host/20261110-0813 (six), host/20261111-0609 (two), host/20261111-1203 and pi/20261110-0813.
- The five fixes of the release run's problems, #296 to #300: pi/20261111-1444, cofold/20261111-1445, daemon/20261111-1447, container/20261111-1507 and plugin/20261111-1507.
- daemon/20261110-0947, ahpd runs from an image: task 06 is #312, and tasks 01 to 05 were reviewed on 2026-11-11.
- plugin/20261113-0534, a piece shows its host mark again: #317.
- container/20261113-0721, a part on a prerelease takes a newer prerelease: #319.
- container/20261113-0507, the ahpd part follows the last release: #316.
- #321: bots/20261113-0817-a-bot-talk-is-one-session-with-back-chats, host/20261113-0817-an-agent-sets-a-new-sessions-folder and host/20261113-0817-a-plugin-chat-has-an-origin-and-tools. They close after [pending/bot-talk-checks.md](../pending/bot-talk-checks.md).
- bots/20261113-1959, a bot answers on a host with no users: #322.
- host/20261113-2009, an operation reads plain in the client's language: #323.
- container/20261113-2134, dev container cases wait for the first listing: #324.
- host/20261113-2243, a held test folder fails no job, and the cofold truncation case says how its turn ended: #325.
- plugin/20261113-2254, plugin warnings go to the daemon's log: #326.
- host/20261113-2319, three cases that fail at random wait on what they mean: #327.
- host/20261113-2331, two Windows cases wait on what they read: #328.
- container/20261113-0408, a part is pulled by its digest: #315. Dry run 43367407253 on its branch passed on 2026-11-13, with `parts`, `release` and `image` each after the one before. Its first tag run checks the artifact steps, which a dry run skips.

## Next

- Planned on 2026-11-25 with Softov, before the bump to rc.1: [a default agent is chosen](../plans/host/20261125-2148-a-default-agent-is-chosen/plan.md), then [a bot's agent changes and its fields clear](../plans/bots/20261125-2148-a-bots-agent-changes-and-clears/plan.md). Both are merged: #481 and #482. Both plans stay `active` until Softov's review says built. His daemon needs a restart to load them.
- #480 from beorn is merged, with commits 02dcf48c0 and 3dea6d552 on top. A refused plugin move keeps what moved, and the Windows helper logs it.
- The ahpw bot form is merged: ahpw #148 and #149. Its plan stays `active` until Softov's review says built.
- Lists step 1 is merged as #485. The next steps are planned on 2026-11-26, each requiring it: [instances](../plans/plugin/20261126-0538-a-list-has-instances/plan.md), [operations onto kinds](../plans/plugin/20261126-0538-a-plugin-adds-operations-to-kinds/plan.md), [processes](../plans/plugin/20261126-0538-a-process-is-what-ahpd-runs/plan.md), [runtime kinds](../plans/plugin/20261126-0538-a-list-holds-runtime-kinds/plan.md), which requires processes, and [translated operations](../plans/plugin/20261126-0538-a-lists-operations-are-translated/plan.md). None is started.
- Planned on 2026-11-26: [a new bot never takes a used folder](../plans/bots/20261126-0335-a-new-bot-never-takes-a-used-folder/plan.md), from the problem a test host made on Softov's `goo`. Merged as #484; the plan stays `active` until Softov's review says built.
- The bot talk is merged: #321, then #322 for a host with no users. What was fixed and why is in the plans' Resume states and implemented records.
  - Found on main: [the chats of a bot talk share one log](../plans/bots/20261123-0945-each-bot-chat-keeps-its-own-log/plan.md).
  - A Back chat is titled `@main/<bot>/<person>`, with `main` fixed for now (Softov, 2026-11-13). The host name in `root:<host>` is `os.hostname()`, and nothing sets it yet; see [briefs/the-root-owner-has-a-fixed-host-name.md](../briefs/the-root-owner-has-a-fixed-host-name.md).
  - Gumbo and ember in Softov's `~/.config/ahpd/bots` name `provider: claude`, at his request.
- #323, the operations in the client's language, is merged on 2026-11-13, as `271c212d9`, after #324 fixed three dev container cases that fail at random. The plans close on Softov's word.
- A review of the CI failures on main, on 2026-11-13, gave #325 to #328. What is left of the cases that fail at random is in *Tests*. The other open problems need Softov's choice, or change more of the daemon than a fix of a test.
- ahpd speaks AHP 1.1.0 on main: [host/117](../plans/host/117-ahpd-speaks-ahp-1-1-0/plan.md) was read again on 2026-11-21 and is `built`. The rest of 1.1.0 is six plans of 2026-11-24, being built in this order on Softov's word: [host/20261124-0923-the-small-wire-items-of-ahp-1-1-0](../plans/host/20261124-0923-the-small-wire-items-of-ahp-1-1-0/plan.md), [host/20261124-0942-a-changeset-file-says-it-is-being-edited](../plans/host/20261124-0942-a-changeset-file-says-it-is-being-edited/plan.md), [host/20261124-0930-a-reasoning-part-says-how-long-it-took](../plans/host/20261124-0930-a-reasoning-part-says-how-long-it-took/plan.md), [host/20261124-0944-a-chat-runs-on-an-agent-of-its-own](../plans/host/20261124-0944-a-chat-runs-on-an-agent-of-its-own/plan.md), [host/20261124-0945-a-moved-chat-says-where-it-went](../plans/host/20261124-0945-a-moved-chat-says-where-it-went/plan.md) and [claude/20261124-0943-an-mcp-servers-skills-show-and-load](../plans/claude/20261124-0943-an-mcp-servers-skills-show-and-load/plan.md). Two cofold plans come first for the last two items, at cofold `f08ce52`: agent/20261124-0945-a-part-says-when-it-ran and agent/20261124-0950-the-mcp-client-reads-a-servers-skills. Softov allowed on 2026-11-24: commit, PR and merge each ahpd PR when green; commit and release cofold, and build on the local cofold while npm stages it.
- ahpc's `cli/20261112-0821-create-session-waits-on-progress`, in the ahpc repository, can be built. A create that makes no machine sends no progress, so ahpc keeps its timeout for it.
- [host/20261112-0821-an-unused-new-session-is-removed](../plans/host/20261112-0821-an-unused-new-session-is-removed/plan.md) stays `draft`. Softov chose deletion as VS Code does. Its Resume state holds the research and two questions before task 01 is rewritten.
- The brief [the-terminal-tool-runs-on-windows-when-set.md](../briefs/the-terminal-tool-runs-on-windows-when-set.md) is for after 0.16 (Softov, 2026-11-24). Its open points are where the setting lives and its name.
- ahpw's plan plugins/20261112-0221-a-record-draws-the-operations-it-offers is unblocked by #302. Another session builds it on Softov's word.
- plugin/20261106-1058, CI fails only for a real fault: `planned`, high, five tasks `todo`.
- [cofold/20261111-1054-cofold-reads-the-cofold-names](../plans/cofold/20261111-1054-cofold-reads-the-cofold-names/plan.md) waits for a `@cofold/copapo` release that reads the cofold names.

## Open findings with no brief yet

- ahpw's plan `plugins/20261115-0746-a-person-finds-a-plugin-to-install` is merged in ahpw #86 (`108a3e719`), with four tasks `implemented`, and waits for Softov's review. The Plugins sidebar is one list with search and Install. An installed plugin's page has Overview, Features and Settings from its own package, and Marketplace facts only when it came from a list.
- Softov's test of 2026-11-15 found that `x-ahpd/plugins/remove` gave npm the row id, and that `npm uninstall` ran without `--legacy-peer-deps`. Both are fixed in #339. His `~/.config/ahpd` may still hold `@ahpd/web` in `package.json`, since that uninstall failed.
- The plugin list names first-party plugins without their scope, such as `agent-acp`. ahpd names them `ahpd-agent-acp`, since none exports a `name`. The plugins repository's check (`scripts/check.mjs`, `unscoped`) holds the list to the first rule. The build of plugin/20261113-2029 matches by source first.
- Each read of the session list starts one server per ACP preset that has `session/list`, 8 on Softov's box. A fix would answer from the record and ask the servers only on a refresh.
- A restored ACP session shows the host's added first-prompt text as the person's own words, in Codex and Gemini.
- `/mcp` keeps no session, so an MCP client is not a row in `x-ahpd-clients`. Softov likes an `Mcp-Session-Id` for it.
- The policy form saves a row that can do nothing: a `deny` with limits, or an empty `match`. A row's `pool` and a limit's `pool` are two things under one word.
- Build session `01927fa8` finished its turn, but the host marked it `error` 10 s after start and froze its record. Softov's terminal log for 07:13 local on 2026-11-11 holds the cause.
- `@` lists nothing on a daemon whose PATH has no `rg`. [briefs/at-lists-files-without-rg-on-the-path.md](../briefs/at-lists-files-without-rg-on-the-path.md) holds the ways to fix it.
- An ACP server's stderr line with no level, such as gemini's, is logged at info.
- Some test helpers give up after a count of event-loop turns, not after a time, such as the `until(check, times)` of cofold-turn, nested-proxy and computer-disposable.
- A Copy button beside a view's link needs a client-side copy action across ahpd's view checker, ahpw and ahpc.
- Two comments in `packages/sdk/src/host/tooling.ts`, at lines 448 and 746, still name `heldAs`, which #191 removed.
- A `usage-port.test.ts` case, where a plugin takes the usage port over, timed out on Windows at `8db0b85b5`. It timed out before, as the implemented record of claude/20261028-2213 says.

## The release run of 2026-11-11

Its notepad is [release-run.md](release-run.md), its agent tests are in [release-run.md](release-run.md#agent-tests), and its ranked problems are in [problems-report-20261111.md](problems-report-20261111.md). The OpenAI key has no credit, so Codex ends at "Quota exceeded".

## Waiting for Softov

- What 0.15.0 needs is in [pending/release.md](../pending/release.md#left). On 2026-11-18 Softov chose nine problems to fix before it, and seven to wait for 0.16. The nine are fixed by seven plans, merged on 2026-11-18 as #377 to #383, the last at `6d2741cf4`. All seven are `built`, and so are the seven built plans that waited on their checks.
- `0.15.0-rc.2` is tagged with the machine parts pulled by tag. The digest pin is #315 on main since 2026-11-13, so the next release pins the parts.
- `ghcr.io/ahpio/ahpd` and the 17 part packages are public since 2026-11-12. A new part gets a private package on its first push, and Softov makes it public on its settings page. An anonymous token from `https://ghcr.io/token?scope=repository:<name>:pull&service=ghcr.io` reads a manifest to check one.
- `edge.yml` has no paths filter, so a plan-only push to main builds the edge image. A `paths-ignore` is suggested.
- The API keys in his private env file were shown in a chat on 2026-11-11. He rotates them.
- The grant role editor in ahpw shows the new subjects of #205. Nobody has opened it in a browser.
- [problems/a-refused-back-turn-stays-working-in-another-window.md](../problems/a-refused-back-turn-stays-working-in-another-window.md): check after the daemon restart.
- [briefs/a-claude-login-shows-its-account-and-plan.md](../briefs/a-claude-login-shows-its-account-and-plan.md) is covered by plugin/20261106-0438, now `built`. Delete it on his word, with a `git://` ref in the plan.
- Open plans that need his word:
  - host/20261031-1200, the sdk's text is plain, `draft`: he answers the *Choices to check* of [research/sdk-plain-text-strings.md](../research/sdk-plain-text-strings.md).
  - host/83, `active`: p1 to p5 are `built`. Close it on his word.
  - container/02, `active`: three tasks are `blocked`.
  - container/05, `active`: p12 is `draft`, and every other part is `built` or `dropped`.
  - container/20261030-1141, the VM plan, `active`: task 01 waits for [pending/vm-01-dev02-libvirt.md](../pending/vm-01-dev02-libvirt.md).
- Briefs and an idea that wait for a plan: [the-change-counters-agree.md](../briefs/the-change-counters-agree.md), [the-text-a-person-reads-is-plain.md](../briefs/the-text-a-person-reads-is-plain.md), [a-tunnel-token-that-lasts.md](../briefs/a-tunnel-token-that-lasts.md), [the-policy-check-is-a-server-setting.md](../briefs/the-policy-check-is-a-server-setting.md) and [ideas/acp-resumable-doubt.md](../ideas/acp-resumable-doubt.md).
- `restartNeeded` stays a read-only root config value. ahpw and ahpapp read it there next, in their own repositories.
- The preset allow-list edit in `~/.config/ahpd/agents/claude-deepseek-build.json`.
- A test session `claude-deepseek:/845c1908-…` is on his daemon. Remove it only when he says so.

## Outside this repository

- ahp-review has no remote. Its tree has edits that are not committed, among them `briefs/ahpd-merge-notes.md`.
- What ahpc lacks against ahpd is in `ahp-review/briefs/ahpc-catch-up.md`.
- ahpw plan plugins/09, the Connect button for plugin/71, is built and not committed. It waits for Softov's review.
- ahpw's brief for the alert list and the switch is on ahpw's main (`0f9d12a`). Its plan needs a mockup first. Until then ahpw's pages read `health`, which ahpd no longer sends.

## By Softov's hand

The checks in [pending/](../pending/).
