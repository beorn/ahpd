---
title: configure asks on the cofold prompts
domain: daemon
status: built
priority: high
created: 2026-11-21
revalidated: 2026-11-21
requires: []
changes: []
creates: []
decisions: []
problems: []
refs:
  - git://fd7084712 - the commit of this repository the facts were checked at
  - "[code://packages/server/src/ask.ts#L1-L131](../../../../packages/server/src/ask.ts#L1-L131) - the readline questions this plan replaces with the cofold prompts, and the `Term` seam tests answer through"
  - "[code://packages/server/src/commands/configure.ts#L253-L590](../../../../packages/server/src/commands/configure.ts#L253-L590) - `configure()`, which asks about twenty questions through `ask`, `confirm` and `answering`"
  - "[code://packages/server/src/commands/configure.ts#L592-L670](../../../../packages/server/src/commands/configure.ts#L592-L670) - `runConfigure`, `offerConfigure` and `askToServe`, which ask too"
  - "[code://packages/server/test/server-ask.test.ts](../../../../packages/server/test/server-ask.test.ts) - the tests of the questions, which answer through streams with `isTTY` set"
  - "[code://packages/server/test/server-configure.test.ts](../../../../packages/server/test/server-configure.test.ts) - the tests of the configure flow, to keep meaning the same"
  - "[code://packages/server/package.json#L52](../../../../packages/server/package.json#L52) - `@cofold/terminal` pinned at `^0.4.0`"
  - file:///github/cofold/examples/commands/wizard/flow.ts - cofold's wizard example, the reference for the prompt calls
  - npm://@cofold/terminal@0.5.0 - the prompts this plan adopts: `createPrompts`, `select`, `text`, `confirm`, `NO_TERMINAL`, `PromptCancelled`
---

## Goal

`ahpd configure` asks its questions on the same inline prompts that cofold's terminal package now provides.
A person sees the same questions, in the same order, with the same defaults.
Enter keeps the current value, as it does today.
The change is in how a question is drawn and answered, not in what is asked.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "from 'node:readline" packages/server/src` - the readline questions are in `ask.ts` only.
- `rg "from '../ask.js'|from './ask.js'" packages/server/src` - `configure.ts`, `start.ts` and `run.ts` import `ask.ts`, and `start.ts` and `run.ts` import only `here`.
- `rg "isTTY" packages/server/test` - `server-ask.test.ts` and `logline.test.ts` set `isTTY` on their streams.

### Runtime path

```
ahpd configure -> commands/configure.ts configure() -> ask.ts ask|choose|confirm -> @cofold/terminal createPrompts -> the terminal
```

### Gaps

- `ask.ts` has no tests that check the drawn question. The cofold prompts draw a frame, so the tests check the answer, not the frame.
- `choose` takes a number or a name. A select takes arrow keys. A typed number is no longer an answer; the plan says so in its risks.
- Not found: a test in ahpd that drives the prompts through a pseudoterminal. The refusal on a pipe is tested in cofold; ahpd checks its own refusal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The prompts swap, with the same questions and order | user, 2026-11-21: "Prompts swap, same questions (Recommended)" | 02 |
| Sections, the ACP step and the review step are out of this plan | user, 2026-11-21: same answer | - |
| `config add`, `config remove` and the origins error are a separate plan | user, 2026-11-21: "Later, separate plan (Recommended)" | - |
| `ask`, `choose` and `confirm` keep their names and their `Term` argument | (defaulted: tests and `offerConfigure` keep their shape, so the change stays in `ask.ts`) | 02 |
| `choose` becomes a `select` | (defaulted: a cofold select is the list the prompts draw; numbers are not typed) | 02 |
| The backends, the other plugins and the agents found are each one multiselect, with the current set ticked | user, 2026-11-21: "go ahead" on the multiselect recommendation | 04 |
| The pi removal stays a yes or no, because it follows from the backend choice | (defaulted: a multiselect cannot ask a follow-up for one item only) | 04 |
| ACP is a backend, on by default as Claude is, and the found agents are listed only once ACP is on | user, 2026-11-21: "by default like claude. I think the ACP should be enabled" | 05 |
| The other list offers the main base plugins, and all eight are on by default | user, 2026-11-21: "task, computer, push, bot, webhook, devtunnel, activepieces" and "make all 8 enabled" | 05 |
| ACP's found agents are auto-enabled only when detected; a found agent not on this machine is asked as an install | user, 2026-11-21: "only auto enable the ones detected ... not detected need to be able to select to 'install'" | 06 |
| An install runs its line after the list, when the list ticks it and one confirm says yes; the confirm defaults to no | user, 2026-11-21: "it could ask, to install or not?" with the answer "Run its install line (Recommended)" | 06 |
| httpApi and modelApi are asked as a switch plus the port, after the folders and before the marketplaces | user, 2026-11-21: "There is no step to configure httpApi or modelGateway" with the answer "Switches plus the port" | 06 |
| Configure asks nothing about `modelGateway` beyond the model API's switch and port; its models, `sessionCalls` and `keyRefusal` stay for `ahpd config` and the web UI | user, 2026-11-21: "Nothing more (Recommended)" | - |
| A refusal of every folder says why and asks the folders again | user, 2026-11-21: "It should not repeat the question? with a error line?" | - |
| A run ends with a saved group, a next-steps group with coloured commands, and "Done." | user, 2026-11-21: the sketch with "Configuration saved" and "What's next?", "With commands colored" and "I prefere the blue from before" | - |
| `ahpd start` ends with a "Daemon started" group, `ahpd status` and `ahpd stop`, and "Done ahpd is running." | user, 2026-11-21: "yes" with the sketch | - |
| The `Term` seam keeps injected streams | (defaulted: tests answer through streams, as they do now) | 03 |
| Unknown keys are ignored, and a list is not re-asked | (defaulted: the cofold prompts read keys and do not re-ask; a yes or no that is neither waits for the next key) | 02, 03 |
| A closed input and a cancel refuse the question | (defaulted: the close is raced against the prompt, and a cancel gives the closed-terminal error, as readline did) | 02 |

## Proposed architecture

- **Data flow** - the questions take the same `Term`; the answers come back as the same strings and booleans.
- **Event flow** - none. A question is a call that returns an answer.
- **State flow** - none. `configure()` keeps its values in its own locals, as it does now.
- **Layer responsibilities** - `packages/server`: `ask.ts` owns the prompts and the TTY refusal; `commands/configure.ts` owns what is asked.
- **Source-of-truth files** - [`code://packages/server/src/ask.ts`](../../../../packages/server/src/ask.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the terminal package goes to 0.5.0](task-01-terminal-goes-to-050.md) | done | - |
| [02 - ask, choose and confirm call the cofold prompts](task-02-ask-and-confirm-call-the-cofold-prompts.md) | done | 01 |
| [03 - the configure tests keep their meaning](task-03-the-configure-tests-keep-their-meaning.md) | done | 02 |
| [04 - the plugin questions are multiselects](task-04-the-plugin-questions-are-multiselects.md) | done | 03 |
| [05 - ACP is a backend and the other list has the main plugins](task-05-acp-backend-and-main-plugins.md) | done | 04 |
| [06 - the installs and the listeners are asked](task-06-installs-and-listeners-are-asked.md) | done | 05 |

## Risks and tradeoffs

- A list takes arrow keys, not a typed number. A number typed by habit does nothing, so a person who types `2` sees no change and presses Enter.
- A long list does not scroll. Ten found agents fit a 60-row terminal, but a longer list would be cut.
- Without a terminal, `ask` still refuses before any output. The cofold refusal is `NO_TERMINAL`; ahpd keeps its own message, which names the command line, so the two texts differ.
- A cofold prompt cancel (Ctrl+C, Ctrl+D, Escape) throws `PromptCancelled`. `ask.ts` maps it to the same error the closed readline raised, so `configure` stops in the same place.
- The `minimumReleaseAgeExclude` entry for `@cofold/terminal` 0.5.0 changed in `pnpm-workspace.yaml`, so the new version installs.

## Resume state

- **Done so far:** tasks 01 to 06, built 2026-11-21 in this worktree. The server suite and `pnpm typecheck` pass; see [implemented.md](implemented.md).
- **Next action:** none in this plan.
- **Open questions:** none.
- **Watch out for:** `pnpm install` must run in this worktree, not in `/github/ahpd`, after the bump; the packages resolve from `node_modules` in each worktree.

## Final verification checklist

- [ ] `pnpm -r typecheck` passes in this worktree.
- [ ] The server tests pass: `pnpm exec vitest run packages/server/test`.
- [ ] `ahpd configure` answered through a pty asks the same questions in the same order.
- [ ] Without a terminal, `ahpd configure` refuses before it prints anything.
