---
title: A box with no internet gets a copy
domain: container
status: active
priority: medium
created: 2026-11-25
revalidated: 2026-11-25
requires:
  - plans/container/20261125-0130-the-ahpd-part-is-the-releases-own/plan.md
refs:
  - git://6c1da5da2 - the last commit that holds `briefs/the-ahpd-part-is-the-releases-own-build.md`, which this plan and container/20261125-0130 replace
  - git://74ae538c8 - the commit the facts were checked at
  - "[code://packages/computer/src/ssh.ts#L494-L530](../../../../packages/computer/src/ssh.ts#L494-L530) - `installedOn`: one script on the box makes or finds the install"
  - "[code://packages/computer/src/hostinstall.ts#L73-L137](../../../../packages/computer/src/hostinstall.ts#L73-L137) - the script: the download, the check, and the older install in its place"
  - "[code://packages/computer/src/parts.ts#L879-L920](../../../../packages/computer/src/parts.ts#L879-L920) - `tarEntry`, which takes no file name over 100 bytes"
  - "[code://packages/computer/src/template.ts#L195-L205](../../../../packages/computer/src/template.ts#L195-L205) - files sent to a machine as a tar on the stdin of ssh"
  - "[code://packages/server/src/install.ts#L80-L125](../../../../packages/server/src/install.ts#L80-L125) - how npm is started on every platform, with no shell"
---

## Goal

An ssh box that has no ahpd and cannot download one still runs a session. Its host downloads the files, keeps them, and copies them to the box over ssh.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "installedOn|HOST_INSTALL_COMMAND" packages/computer/src` - one caller runs the script, and refuses the session when no install runs.
- `rg -n "npm-cli" packages/*/src` - only the server starts npm, and the computer plugin does not import the server.

### What was tried on 2026-11-25

- `npm ci --ignore-scripts --os linux --cpu arm64 --cache <folder>` on this host filled a cache with another platform's packages. Only the x64 cache was installed from.
- `npm ci --offline --cache <folder>` installed the server and the plugins from the x64 cache, and `ahpd --version` answered.
- The x64 cache is 47 MB compressed, and the x64 Node download is 32 MB.

### Runtime path

```
session on a box -> the script fails and finds no install -> host downloads and caches -> tar over ssh -> the script again, from the copied files -> session
```

### Gaps

- The script's failure does not say whether the box has a platform that a copy can serve.
- The tar writer takes no name as long as those in npm's cache.

## Answers

| What | Source | Task |
| --- | --- | --- |
| When the download of the box fails, the host downloads and caches the files, and copies them to the box over ssh | Softov, 2026-11-24: "both" | 01, 02 |
| A box with a working older install runs it, and the copy runs only when there is none | Softov, 2026-11-25: "Older install first, copy only when none" | 02 |
| The copy covers Node and the npm packages of both locks | (defaulted: the box needs both) | 01 |
| The box checks the copied files against the same sums and integrity | (defaulted: the only safe answer) | 02 |
| The host keeps the files of an install, per platform, for a week after their last use | (defaulted: two daemons of one user may hold two versions) | 01 |

## Proposed architecture

- **Data flow** - the host fills a folder with the Node download and an npm cache for the box's platform. It sends the folder as one tar. The script installs from it in place of `curl` and the registry.
- **Layer responsibilities** - `hostcopy.ts`: the folder and the tar · `hostinstall.ts`: the script that takes it · `ssh.ts`: when it runs.
- **Source-of-truth files** - [`code://packages/computer/src/hostinstall.ts`](../../../../packages/computer/src/hostinstall.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host holds the files of an install](task-01-the-host-holds-the-files-of-an-install.md) | done | - |
| [02 - A box installs from a copy](task-02-a-box-installs-from-a-copy.md) | done | 01 |

## Risks and tradeoffs

- A box with an older install and no internet stays on it until that install is removed. Softov chose this.
- The first copy sends about 80 MB before the session starts. The transfer has the ten minutes of every ssh transfer.
- A package whose install script downloads a file does not get that file on an offline box. The offline test ran with npm 12, which skips those scripts by default. The part's Node 24 has an older npm, so the check by hand covers them.
- A host with no internet cannot fill its folder, and the session is refused with both reasons.

## Resume state

- **Done so far:** tasks 01 and 02 on 2026-11-25, as [implemented.md](implemented.md) says.
- **Next action:** the check by hand in [pending/a-box-with-no-internet.md](../../../pending/a-box-with-no-internet.md), then Softov's review.
- **Open questions:** none.
- **Watch out for:** the install's key must be equal with and without the copy, so the copied folder is not one of the pinned values.

## Final verification checklist

- [ ] `pnpm typecheck` and the computer suite pass, on Windows CI too.
- [ ] A box in a container with no route out runs a cofold session from a copy.
