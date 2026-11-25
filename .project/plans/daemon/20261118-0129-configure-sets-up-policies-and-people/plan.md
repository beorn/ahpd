---
title: Configure sets up policies and people
domain: daemon
status: built
priority: medium
created: 2026-11-17
revalidated: 2026-11-17
refs:
  - git://531f8fcff - the last commit that holds the brief configure-sets-up-policies-and-people.md, which this plan covers
  - "[code://packages/server/src/commands/configure.ts#L227-L452](../../../../packages/server/src/commands/configure.ts#L227-L452) - `configure`: the questions, the one write of the file, and the install"
  - "[code://packages/server/src/commands/configure.ts#L521-L564](../../../../packages/server/src/commands/configure.ts#L521-L564) - `askToServe`, a question whose Enter keeps No, and `declareConfigure`, the command"
  - "[code://packages/server/src/ask.ts#L70](../../../../packages/server/src/ask.ts#L70) - `ask` and `confirm`, the two prompts every question uses"
  - "[code://packages/server/src/commands/user.ts#L54-L80](../../../../packages/server/src/commands/user.ts#L54-L80) - `people`, which opens `fileUsers` on the configuration's `users` file"
  - "[code://packages/server/src/commands/user.ts#L150-L196](../../../../packages/server/src/commands/user.ts#L150-L196) - `user.add`, which `configure` adds a person the same way as"
  - "[code://packages/sdk/src/access/users.ts#L29-L40](../../../../packages/sdk/src/access/users.ts#L29-L40) - `BUILT_IN`: `admin`, `member` and `guest`"
  - "[code://packages/sdk/src/access/users.ts#L1303](../../../../packages/sdk/src/access/users.ts#L1303) - the defined roles, the file's and the built-in ones, read here and at L1559"
  - "[code://packages/server/src/config.ts#L939](../../../../packages/server/src/config.ts#L939) - `policiesPath`, the store beside the configuration"
  - "[code://packages/sdk/src/access/policies.ts#L318-L368](../../../../packages/sdk/src/access/policies.ts#L318-L368) - `filePolicies`, whose `put` writes every row it holds over the file"
  - "[code://packages/sdk/src/host/machines.ts#L426-L471](../../../../packages/sdk/src/host/machines.ts#L426-L471) - a session is checked for `agent` and `computer`, and no computer means `host`"
  - "[code://packages/server/test/server-configure.test.ts#L32-L45](../../../../packages/server/test/server-configure.test.ts#L32-L45) - `terminal`, which answers Enter past the answers a case names"
  - https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/ - `kubeadm init` ends with the commands to run next, page for Kubernetes v1.37
---

## Goal

`ahpd configure` sets up the first person and the policies, so that a person can start a session with no hand-written policy.
On 2026-11-17 Softov's first session as a person was refused, because the store held no `agent` row and no `computer` row.
The run ends with the commands to run next, as `kubeadm init` does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.
The brief that this plan covers held the research; its last commit is the first ref.

### Searches performed

- `rg "people\(|fileUsers\(" packages/server/src` - every user command opens the users file through `people`.
- `rg "BUILT_IN" packages/sdk/src/access/users.ts` - the defined roles are put together in two places, and nothing exports them.
- `rg "policiesPath" packages/server/src` - the daemon opens the store at `policiesPath()`, read once at start.
- `gh pr list -R ahpio/ahpd` and the fork branches - nothing else changes these files at `531f8fcff`.

### Gaps

- `configure` asks nothing about people or policies.
- No call answers the roles a host defines.
- `policiesPath` takes no folder, so a test cannot point `configure` at a store of its own.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `configure` asks whether to turn the policy checks on | Softov, 2026-11-17: "Also ask to turn the check on" | 02 |
| The starter rows cover `agent`, `computer` and `model` | Softov, 2026-11-17: "Agent, computer and model" | 02 |
| The end asks whether to add a person, then prints the next commands | Softov, 2026-11-17: "Ask to add a person, print the rest" | 01 |
| The role question lists the roles the host defines, and takes a comma-separated list | Softov, 2026-11-17: "ask user role, suggest the existing ones, accept with comma?" | 01 |
| Enter on the role question gives `member` | (defaulted: the one built-in role that can start a session; `guest` cannot, and `admin` skips every policy) | 01 |
| Enter on "Add a person now?" is No | (defaulted: every question keeps what is there on Enter, and `askToServe` keeps No for a grant) | 01 |
| The person question comes before the policy questions | (defaulted: so the policy questions run on a users file set in the same run) | 01, 02 |
| A host with no `users` file gets `<config dir>/users.json` when a person is added | (defaulted: `ahpd user add` refuses without a users file) | 01 |
| The token command is printed and not run | (defaulted: no credential is printed unless somebody asks for it) | 01 |
| `ahpd start` is printed by the command only, not by the first-start offer | (defaulted: the offer starts the daemon right after `configure`) | 01 |
| The check question is asked on a host with a `users` file, and Enter keeps the file's value | (defaulted: a host with no people is never checked) | 02 |
| A kind is covered when an allow row of scope `all` names `*` for the kind's own value type | (defaulted: that is the row whose absence refuses every person) | 02 |
| Enter on the starter rows question is Yes | (defaulted: it is asked only when the check is on and a kind would refuse every person) | 02 |
| The starter rows are `everyone-agent`, `everyone-computer` and `everyone-model`; a taken id is said and skipped | (defaulted: `put` refuses a different row under an id the store holds) | 02 |
| `policiesPath` takes the folder, with `configDir()` as its default | (defaulted: `configure` is given its folder, and its tests pass their own) | 02 |
| `configure` reads a relative `users` and `connectionTokenFile` against the configuration folder, and keeps them as written | Softov, 2026-11-18: "Fix both paths now" | 03 |

## Proposed architecture

- **Data flow** - `configure` asks its questions of today, then the person, then the policy checks, then the starter rows. It writes the file once, then the rows, then installs plugins.
- **State flow** - the person goes to the users file through `fileUsers`. `policies.check` and `users` go to the configuration, and the rows go to `policies.json`.
- **Layer responsibilities** - server: `configure.ts`, `config.ts` · sdk: `users.ts` gives `roleNames` · docs: `CONFIGURE.md`, `POLICY.md`.
- **Source-of-truth files** - [`code://packages/server/src/commands/configure.ts`](../../../../packages/server/src/commands/configure.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - configure adds a person](task-01-configure-adds-a-person.md) | done | - |
| [02 - configure turns the policy checks on](task-02-configure-turns-the-policy-checks-on.md) | done | 01 |
| [03 - configure reads paths from its folder](task-03-configure-reads-paths-from-its-folder.md) | done | 01 |

## Risks and tradeoffs

- A running daemon keeps its rows in memory, and its next write replaces the file - `configure` then says to restart the daemon.
- A `model` row opens every model to every person, which is a cost decision - the question says so before the person answers.
- A yes to the check question refuses every person no row covers - the starter rows question comes right after it.

## Resume state

- **Closed on 2026-11-18** on Softov's word: every task is `done` or `dropped`, and [implemented.md](implemented.md) says what exists now.
- **Checks, 2026-11-18:** every item of *Final verification checklist* passed, on the test daemon and the suites at `2946984b6`.
- **Done so far:** tasks 01 and 02 are `implemented` on 2026-11-17, on the branch `daemon/20261118-0129-configure-sets-up-policies-and-people`.
- **Next action:** Softov's review. Merged in #372 on 2026-11-18.
- **Check on the test daemon, 2026-11-18:** `configure` asked every new question and wrote the three rows, and a `member` started a Claude session. Without `everyone-computer`, the same create was refused with `no policy allows computer host`.
- **Found in the check:** `configure` read a relative `users` and `connectionTokenFile` from the current folder. Task 03 fixes it, on the branch `daemon/20261118-0129-configure-reads-paths-from-its-folder`.
- **Open questions:** none.
- **Watch out for:** the test terminal answers Enter past the answers a case names. Each new question must keep what is there on Enter.

## Final verification checklist

- [x] The server suite passes, and `check` and `check-windows` are green.
- [x] A first `ahpd configure` with Enter at every question writes what it wrote before this plan, and adds no person and no row.
- [x] On the test daemon on 39200, a `member` with the check on and the starter rows starts a Claude session.
