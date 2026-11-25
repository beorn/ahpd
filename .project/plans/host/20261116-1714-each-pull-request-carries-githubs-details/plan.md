---
title: Each pull request of a session carries what GitHub says of it
domain: host
status: built
priority: high
created: 2026-11-16
revalidated: 2026-11-16
changes:
  - specs/git-and-changes.md
refs:
  - git://55907c208 - the last commit that holds the brief this plan covers, `briefs/a-client-shows-what-github-says-of-a-pull-request.md`
  - git://e471ba827 - the last commit that holds the problem `problems/a-recorded-pull-request-never-shows-merged.md`, which the brief covered
  - "[code://packages/sdk/src/types/github.ts#L6-L15](../../../../packages/sdk/src/types/github.ts#L6-L15) - `PullRequest`, the port's answer: `url`, `state`, and an optional `title` and `createdAt`"
  - "[code://packages/sdk/src/repo/github.ts#L90-L131](../../../../packages/sdk/src/repo/github.ts#L90-L131) - the lists by branch, over REST and `gh pr list`"
  - "[code://packages/sdk/src/repo/github.ts#L143-L184](../../../../packages/sdk/src/repo/github.ts#L143-L184) - `byUrl`, over REST and `gh pr view`, which keeps the state and the title only"
  - "[code://packages/sdk/src/repo/github.ts#L277-L295](../../../../packages/sdk/src/repo/github.ts#L277-L295) - `coreIn`, the agent merge's read of `pulls/<number>`, the pattern for the REST fields"
  - "[code://packages/sdk/src/host/facts.ts#L106-L186](../../../../packages/sdk/src/host/facts.ts#L106-L186) - `metaOf`, where a session's `_meta` is composed"
  - "[code://packages/sdk/src/host/facts.ts#L454-L462](../../../../packages/sdk/src/host/facts.ts#L454-L462) - `watchedIn`, whether a client watches a directory"
  - "[code://packages/sdk/src/host/facts.ts#L545-L571](../../../../packages/sdk/src/host/facts.ts#L545-L571) - `stopWatchingDir` and `startWatchingDir`, the per-directory watch the poll follows"
  - "[code://packages/sdk/src/host/facts.ts#L598-L670](../../../../packages/sdk/src/host/facts.ts#L598-L670) - `refreshPullRequests`, which reads the branch's pull request only, and nothing with `autoAttachPullRequests` off"
  - "[code://packages/sdk/src/host/facts.ts#L623-L626](../../../../packages/sdk/src/host/facts.ts#L623-L626) - `candidatesOf`, a session's recorded and associated pull requests"
  - "[code://packages/sdk/test/github.test.ts](../../../../packages/sdk/test/github.test.ts) - the port's cases"
  - "[code://packages/sdk/test/host-github.test.ts](../../../../packages/sdk/test/host-github.test.ts) - the session's GitHub facts cases"
  - "[code://docs/sdk/SESSIONS.md](../../../../docs/sdk/SESSIONS.md) - where a session's `_meta` keys are documented"
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/common/github/types.ts#L76-L97 - `IGitHubUser` and `IGitHubPullRequest`, the names this plan's fields take
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/common/github/sessionGitHubReferences.ts#L62-L121 - VS Code's window lists the recorded and the associated pull requests
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/sessions/contrib/github/browser/github.contribution.ts#L254-L283 - VS Code's window reads each one once, and polls it unless it is merged and not shown
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/browser/github/models/githubPullRequestModel.ts#L22 - the poll interval, 60 seconds
  - https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/platform/agentHost/node/agentHostPullRequestStatusService.ts#L502-L523 - VS Code's host watches one pull request per folder, which is why its window reads the rest
---

## Goal

Each pull request a session shows carries what GitHub says of it, so a client can draw VS Code's pull request card.
The card shows the repository, the date, the title and number, the state, the description, `base ← head` and the author.
Today a recorded pull request carries only the label the agent gave it, and a state shows for one URL per folder.
On 2026-11-16 a session merged #349, and #349 never showed merged.
ahpw draws the card in its plan `sessions/20261116-1714-the-pull-request-card-shows-github`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "byUrl|forBranch" packages/sdk/src` - the port has the two reads, and `facts.ts` calls `byUrl` only for the branch's known pull request.
- `rg "'ahpd\.[a-zA-Z]+'" packages/sdk/src` - ahpd's own `_meta` keys are named `ahpd.<name>`, such as `ahpd.owner` and `ahpd.cost`.
- `rg "githubData|_meta.github" docs .project/specs` - `docs/sdk/SESSIONS.md` and `specs/git-and-changes.md` say what the session's GitHub facts are.
- `gh pr list -R ahpio/ahpd --state open` and `git diff main...<branch>` for each branch, on 2026-11-16 - nothing else changes `facts.ts`, `repo/github.ts` or `types/github.ts`.

### Runtime path

```
turn end / subscribe / operation -> readFacts(dir) -> refreshPullRequests(dir)
  -> port.forBranch (the branch's) and port.byUrl (each recorded or associated one)
  -> details held per directory, by URL -> metaOf(uri) puts the session's own under `ahpd.pullRequests`
  -> session/metaChanged -> a client draws the card
a client watches the directory -> every 60 s the open ones are read again -> metaChanged when one moved
```

### Gaps

- `PullRequest` has no number, author, description, branches, draft or dates.
- `byUrl` and both lists ask GitHub for none of them.
- A recorded or associated pull request is never read, with `autoAttachPullRequests` on or off.
- Nothing reads a pull request again on a timer, so a merge made outside a turn shows at the next facts read only.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Each pull request carries the state and all the details, not the state alone | Softov, 2026-11-16: "State and all details"; "put the PR information inside the PR and show it" | 01, 02 |
| The details are the number, title, description, state, draft, author, base and head branch, and when it was opened, updated, merged and closed | Softov, 2026-11-09 and 2026-11-16, with VS Code's card | 01 |
| The fields take the names of VS Code's `IGitHubPullRequest`: `number`, `title`, `body`, `state`, `isDraft`, `author.login`, `baseRef`, `headRef`, `createdAt`, `updatedAt`, `mergedAt`, `closedAt` | [VS Code `types.ts`](https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/common/github/types.ts#L76-L97) | 01 |
| `author` carries `login` and `avatarUrl`, as `IGitHubUser` | [VS Code `types.ts`](https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/common/github/types.ts#L76-L79) | 01 |
| The new fields are optional on `PullRequest`, so a plugin's port that sends none still works | (defaulted: `registerGithub` takes a plugin's port, as `docs/plugins/PLUGINS.md` says) | 01 |
| ahpd reads every pull request the session shows: the branch's, the recorded ones and the associated ones | Softov, 2026-11-16: "put the PR information inside the PR and show it" | 02 |
| They are read with `autoAttachPullRequests` on or off; a read associates nothing new | (defaulted: a client of ahpd has no GitHub account, so the host reads what VS Code's window reads) | 02 |
| The details go under `_meta['ahpd.pullRequests']`, one entry per pull request keyed by its URL, only the session's own | (defaulted: VS Code's `_meta.github` stays as upstream has it, and one map covers recorded and associated ones) | 02 |
| `body` is cut at 1000 characters, with `bodyTruncated: true` when it was cut | (defaulted: `_meta` goes with every session summary) | 02 |
| A merged pull request is not read again once it is held as merged | [VS Code `github.contribution.ts`](https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/sessions/contrib/github/browser/github.contribution.ts#L264-L275) | 02, 03 |
| While a client watches the directory, its open and closed pull requests are read again every 60 seconds | [VS Code `githubPullRequestModel.ts`](https://github.com/microsoft/vscode/blob/6e68549edb69380c9316e49df5d3795d5064a2b0/src/vs/workbench/contrib/sessions/browser/github/models/githubPullRequestModel.ts#L22) | 03 |
| A read that fails keeps what was held | [code://packages/sdk/src/host/facts.ts#L654-L657](../../../../packages/sdk/src/host/facts.ts#L654-L657) | 02, 03 |

## Proposed architecture

- **Data flow** - The port answers a `PullRequest` with the details. `facts.ts` holds them per directory by URL key. `metaOf` picks the session's own URLs and sends their details.
- **Event flow** - A facts read or a poll that changes a held entry calls `metaChanged(dir)`, as the branch's state does today.
- **State flow** - The details live in memory only. A restart reads them again at the first facts read.
- **Layer responsibilities** - sdk `repo/github.ts`: ask GitHub and map its answer · sdk `host/facts.ts`: choose what to read, hold it, poll, publish · ahpw: draw it.
- **Source-of-truth files** - [`code://packages/sdk/src/types/github.ts`](../../../../packages/sdk/src/types/github.ts) for the fields, [`code://packages/sdk/src/host/facts.ts`](../../../../packages/sdk/src/host/facts.ts) for the key.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the port reads a pull request's details](task-01-the-port-reads-a-pull-requests-details.md) | done | - |
| [02 - a session sends its pull requests](task-02-a-session-sends-its-pull-requests.md) | done | 01 |
| [03 - an open pull request is read each minute](task-03-an-open-pull-request-is-read-each-minute.md) | done | 02 |
| [04 - the docs name the details](task-04-the-docs-name-the-details.md) | done | 02 |

## Risks and tradeoffs

- One GitHub read per recorded pull request at each facts read - at most ten per session, and a merged one is not read again.
- The poll spends the token's API budget while a client watches - only open and closed ones, once a minute, as VS Code's window does.
- `_meta` grows with each pull request - the description is cut at 1000 characters.

## Resume state

- **Done so far:** tasks 01 to 04 built on 2026-11-16 on branch `host/20261116-1714-each-pull-request-carries-githubs-details`, awaiting review.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Watch out for:**
  - VS Code's `_meta.github` keys and `pullRequestState` stay exactly as they are; the details are a new key beside them.
  - `gh` spells the state `OPEN`, `CLOSED` and `MERGED`, and names the branches `baseRefName` and `headRefName`.
  - Run the sdk suite and the computer suite, one at a time, as HANDOFF *Tests* says.

## Final verification checklist

- [ ] `pnpm typecheck` passes.
- [ ] The sdk suite and the computer suite pass.
- [ ] On the test daemon on port 39200, with `autoAttachPullRequests` off, a session records a merged pull request of another branch.
  Its `ahpd.pullRequests` entry has `state: "merged"`, the title, the author and the branches.
- [ ] `check` and `check-windows` are green on the PR.
