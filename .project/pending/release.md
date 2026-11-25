---
title: What a release needs before its tag
---

# What a release needs before its tag

`v0.15.0` is tagged on `3bf557618` (#394) on 2026-11-20, and npm serves the 13 packages at `latest: 0.15.0`. ahpw `v0.9.0` is on `latest` beside it. Nothing is left for 0.15.0. Status at 2026-11-20.

A pushed `v*` tag runs [release.yml](../../.github/workflows/release.yml) and stages every package. The tag comes last, and only on Softov's word.

## Done

- **0.15.0 and ahpw 0.9.0.** Softov chose the order on 2026-11-20.
  - The notes PR #389, the fixes #393 and #396 and the release PR #394 merged on 2026-11-20. Dry run 44842989304 passed `parts`, `release` and `image` on the release branch.
  - Softov's working day on ahpw and ahpd since 2026-11-19 stood for the checks by hand in *Before 0.15.0*. His words on 2026-11-20: "No, the working day covers it".
  - `v0.15.0` is on `3bf557618`, pushed on Softov's word. Release run 44846720007 passed `parts`, `release` and `image`, and Softov approved the 13 staged packages. `npm i @ahpd/server@latest` in an empty folder says `0.15.0`, and `ghcr.io/ahpio/ahpd` has `0.15.0`, `0.15` and `latest`.
  - The ahpw PR #107 set `@ahpd/sdk` to `^0.15.0`, with the peer `>=0.15.0 <0.16.0-0`, and merged as `d968e1f`. `v0.9.0` was pushed on Softov's word, and release run 44852565143 passed. Softov approved the staged package, and `ahpd plugin install @ahpd/web` installs 0.9.0 beside sdk 0.15.0.

- **The check by hand.** Softov made `compclau` again on 2026-11-19. Its first failure was the sign-in, and a session with a connector worked.
- **The fixes before 0.15.0.** Nine problems were fixed by seven plans, merged on 2026-11-18 as #377 to #383. Each plan is `built`, and its `implemented.md` holds the checks: host/20261118-1043, plugin/20261118-1103, host/20261118-1104, daemon/20261118-1105, plugin/20261118-1106, container/20261118-1107 and container/20261118-1108.
- **The built plans closed** on 2026-11-18, on Softov's word: the three tunnel plans, daemon/20261118-0603, host/20261118-0603, host/20261116-1714 and plugin/20261116-1816. The tunnel plans' checks by hand passed on 2026-11-18.
- **The rc.4 release.** #376 sets `0.15.0-rc.4` and holds the notes for #321 to #375. Dry run 44258114344 passed on its branch. Its PR's `image` failed only because npm did not serve `@ahpd/sdk@0.15.0-rc.4` yet. After the update, npm warns of one zod advisory in `@vscode/sandbox-runtime`: its fix is [plans/container/20261121-2250-the-sandbox-runtime-is-ahpios-fork](../plans/container/20261121-2250-the-sandbox-runtime-is-ahpios-fork/plan.md).
- **After rc.3.** Four PRs merged on 2026-11-13:
  - PR #321 makes a bot talk one session, with a Back chat for each bot and person.
  - PR #322 lets a bot answer on a host with no users.
  - PR #323 sends each operation's text plain, in the client's language.
  - PR #324 fixes three dev container cases that failed at random on Windows.
- **The rc.3 approval.** Softov approved the 13 staged packages on 2026-11-13, and npm serves `0.15.0-rc.3` under `next`. Main's CI run 43442023450 passed `image` on its second rerun after that.
- **The rc.3 release run.** Run 43394827388 passed `parts`, `release` and `image` on 2026-11-13. It passed 9697 tests and staged the 13 packages under `next`. The staged `@ahpd/computer` holds `images/digests.json` with 17 entries, the first tag run of the digest pin of #315 ([container/20261113-0408](../plans/container/20261113-0408-a-part-is-pulled-by-its-digest/plan.md)).
- **The rc.3 bump.** #320 sets `0.15.0-rc.3` and holds the notes for #315 to #319. Dry run 43389493385 passed `parts`, `release` and `image`. Its PR's `image` job failed only on `@ahpd/sdk@0.15.0-rc.3`, which npm does not serve yet.
- **After rc.2.** Five PRs merged on 2026-11-13:
  - PR #315 pulls a part by its digest.
  - PR #316 moves the ahpd part to the last release on npm.
  - PR #317 puts back the Activepieces marks.
  - PR #318 bumps ten parts, the ahpd part to `0.15.0-rc.2`.
  - PR #319 lets a part on a prerelease take a newer one.
- **The image and the parts are public.** Softov made `ghcr.io/ahpio/ahpd` and the 17 part packages public on 2026-11-12. An anonymous read of each answers 200.
- **0.15.0-rc.2 on npm.** Softov approved the 13 staged packages on 2026-11-12. `npm view` gives `next: 0.15.0-rc.2` and `latest: 0.14.0` for each. `@ahpd/server@next` installs in an empty folder and says `0.15.0-rc.2`.
- **Main's CI after the approval.** The `image` job of run 43357606552 passed on its rerun, so `check`, `check-windows` and `image` are green at `150983cbe`.
- **The 0.15.0-rc.2 tag run.** Four PRs merged on 2026-11-12. PR #311 is the release notes, #312 the downgrade check read as semver, #313 the bump and #314 a flaky case. Dry run 43347391118 passed on the tree of `8db0b85b5`. Release run 43354150219 passed 9679 tests, staged the 13 packages under `next`, and pushed `ghcr.io/ahpio/ahpd:0.15.0-rc.2` and `:next`.
- **The release run's limits.** #313 runs the tests under `timeout 1500` and the job under 45 minutes. The first rc.2 dry run, 43336912861, reached the old limit of 600 s.
- **The ahpd part at 0.15.0-rc.1.** #313 moves it from 0.8.0, so the release pushed `ghcr.io/ahpio/ahpd-part/ahpd:0.15.0-rc.1-<hash>`.
- **npm trusts `ahpio/ahpd`.** Softov ran the 13 `npm trust github <package> --file release.yml --repo ahpio/ahpd --allow-stage-publish -y` commands, one for each package of `PUBLISHED`, on 2026-11-12. `-y` answers the command's confirmation.
- **The move to `ahpio/ahpd`.** #290 merged on 2026-11-11: each package's `repository` names `ahpio/ahpd`, and the machine parts come from `ghcr.io/ahpio`.
- **ahpw on the release candidate.** ahpw `aec9fd3` sets `@ahpd/sdk` to `^0.15.0-rc.1`, and `@ahpd/web 0.9.0-rc.1` is on npm.

- **The daemon on main.** Softov restarted the dev daemon on `4b5e1290` with `httpApi` and `modelApi` set, on 2026-11-04, and it works.
- **The release.** Run 41892315275 staged all 13 packages under `next`, and Softov approved them on 2026-11-04. `npm view` gives `next: 0.15.0-rc.1` and `latest: 0.14.0` for each. `@ahpd/server@next` installs in an empty folder and says `0.15.0-rc.1`.

- **The bump.** #231 sets `0.15.0-rc.1` in every published package. The update test takes a pre-release version.
- **A dry run.** Run 41876504603 on the bump branch: tests, build, pack and ranges pass, and the channel is `next`.
- **ahpw on the packed candidate.** ahpw at `acdcdb1`, with the packed `@ahpd/sdk 0.15.0-rc.1`, passes its typecheck and 756 tests.
- **The release notes.** [v0_15.md](../../docs/updates/v0_15.md) holds 0.15.0-rc.1, dated 2026-11-04 in #233, with the unreleased 0.14.1 section moved into it, and #149 to #229. Set the page's `date` when 0.15.0 is tagged.
- **The restart flag in ahpw.** ahpw #46, merged on 2026-11-04, reads `ahpd.restartNeeded` from the root config values.
- **The seven open problems** of the reviews of 2026-11-03 and 2026-10-20, fixed in #225 to #228.

## Before 0.15.0

- **A working day.** Softov uses the daemon on main for one working day: ahpw, VS Code, ahpc, bots, sessions and the tunnel. A fault is a problem file or a fix before 0.15.0.
- **The Compose tag.** The bump sets the default `AHPD_TAG` in [docker/compose.yaml](../../docker/compose.yaml). A stable version takes its `X.Y`, such as `0.15`, and a pre-release takes the full version. The tag check in `release.yml` refuses a tag that the file does not name. The image and the parts on `ghcr.io/ahpio` are public since 2026-11-12.
- **The checks by hand.** [triage.md](triage.md) orders them. The ones for features a user meets first:
  - [cofold-resume-checks.md](cofold-resume-checks.md). The Claude resume passed on 2026-11-09, and the pi resume on 2026-11-10.
  - [host-1347-mcp-checks.md](host-1347-mcp-checks.md), the tools at `/mcp`.
  - [update-checks.md](update-checks.md).
  - [macos-checks.md](macos-checks.md) and [daemon-41-windows-checks.md](daemon-41-windows-checks.md), for the install on macOS and Windows. The install on Linux passed on 2026-11-09.
  - The grant role editor in ahpw: the subjects of #205, such as `operation`, `tunnel` and `client`, show and save. No file yet.

## Not in this release

- Six major problems wait for 0.16, by Softov's choice for 0.15.0, and each says so in its *Fix*. `globalAutoApproveEnabled` keeps VS Code's meaning: [global-auto-approve-keeps-vs-codes-meaning.md](../decisions/global-auto-approve-keeps-vs-codes-meaning.md).
- **AHP 1.1.0.** 0.15.0 speaks AHP 1.0.0, as rc.2 does, and AHP 1.1.0 goes in 0.16 (Softov, 2026-11-13). `@microsoft/agent-host-protocol@1.1.0` is on npm since 2026-11-13. Plan host/117 covers four of its changes and was read against the protocol on 2026-10-22, so 0.16 starts with a new read of it.
- **The ahpd part as the release's own build.** [container/20261125-0130](../plans/container/20261125-0130-the-ahpd-part-is-the-releases-own/plan.md) and [container/20261125-0131](../plans/container/20261125-0131-a-box-with-no-internet-gets-a-copy/plan.md) are planned for 0.16.
- MayCXC's `host/124-an-agents-shell-is-a-terminal-the-person-sees` is not merged. Main has its features from the four host/20261103-1620 plans.
- `plans.mjs` lists the `active` and `draft` plans. None is needed for the release.

## When npm rejects a release

The image and the parts are pushed before the packages are approved on npm, so the image can offer a version that npm does not.
Remove the tags from the image by hand on its package page when the release is refused there.
Then `docker pull` and `npm i` name the same versions.
`latest` is the one tag that a pre-release must never carry, as npm refuses a pre-release under it.
