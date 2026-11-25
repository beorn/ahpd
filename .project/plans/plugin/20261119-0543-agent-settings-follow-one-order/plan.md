---
title: Agent settings follow one order
domain: plugin
status: built
priority: medium
created: 2026-11-19
revalidated: 2026-11-19
refs:
  - git://68a62d37b - the last commit that holds the brief `briefs/agent-settings-at-plugin-and-record.md`, with each form's fields today
  - "[code://packages/agent-acp/package.json](../../../../packages/agent-acp/package.json) - the acp plugin's options"
  - "[code://packages/agent-acp/src/plugin.ts#L96-L198](../../../../packages/agent-acp/src/plugin.ts#L96-L198) - `RECORD_FIELDS`, the acp record's fields in their order"
  - "[code://packages/agent-acp/src/session/opening.ts#L286-L301](../../../../packages/agent-acp/src/session/opening.ts#L286-L301) - acp asks the machine for its command, and a refusal goes on as it is"
  - "[code://packages/agent-claude/package.json](../../../../packages/agent-claude/package.json) - the claude plugin's options"
  - "[code://packages/agent-claude/src/options.ts#L492-L563](../../../../packages/agent-claude/src/options.ts#L492-L563) - `DECLARED` and `OF_A_VARIANT`, the claude record's fields in their order"
  - "[code://packages/agent-claude/src/options.ts#L365-L377](../../../../packages/agent-claude/src/options.ts#L365-L377) - Claude's `portFailures`, which acp copies"
  - "[code://packages/agent-claude/src/spawn.ts#L140-L185](../../../../packages/agent-claude/src/spawn.ts#L140-L185) - how Claude says a machine that could not start the CLI"
  - "[code://packages/agent-claude/src/plugin.ts#L69-L87](../../../../packages/agent-claude/src/plugin.ts#L69-L87) - `defaultsOf`: `paths` and the `computer` options"
  - "[code://packages/agent-claude/src/plugin.ts#L140-L159](../../../../packages/agent-claude/src/plugin.ts#L140-L159) - `open`: the record's `model` and config reach the backend"
  - "[code://packages/agent-cofold/package.json](../../../../packages/agent-cofold/package.json) - the cofold plugin's options, whose order the cofold record takes"
  - "[code://packages/agent-cofold/src/plugin.ts#L89](../../../../packages/agent-cofold/src/plugin.ts#L89) - `NOT_A_RECORD`, the options a cofold record does not take"
  - "[code://packages/agent-cofold/src/plugin.ts#L225](../../../../packages/agent-cofold/src/plugin.ts#L225) - cofold's `hostOnly`, the pattern for Claude's `computerConfigDir` on a record"
  - "[code://packages/agent-pi/package.json](../../../../packages/agent-pi/package.json) - the pi plugin's options, whose order the pi record takes"
  - "[code://packages/agent-pi/src/plugin.ts#L124-L141](../../../../packages/agent-pi/src/plugin.ts#L124-L141) - pi's record schema, which adds `env` at its end"
---

## Goal

Every form of the four agent plugins lists its fields by purpose, in one order of groups. A person reads them in the order Softov set. Claude takes the host's folders and gets a default model, as cofold and pi have. An acp agent says a machine that could not start it in a short sentence, as Claude does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "kindSchema" packages/agent-*/src` - each engine's record schema; cofold and pi build theirs from the options' order.
- `rg "computers.how" packages/agent-acp/src` - the three places acp asks a machine for its command.
- `rg "computer" packages/agent-pi/src packages/agent-cofold/src` - pi and cofold run in a nested `ahpd`, and start no process through the port.
- In ahpw, `src/resources/agents/form.ts` `engineSchema` draws a form in the schema's own order.

### Gaps

- No form follows an order of purpose.
- The claude plugin has no default `model`.
- A claude record cannot set `computerConfigDir`.
- acp has no `portFailures`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every form follows the groups Model, Prompt, Tools, Run, Folders and trust, Machines, Tuning | Softov, 2026-11-19: "Same groups, this order (Recommended)" | 01 |
| The tuning fields of acp and claude stay on the record, last | Softov, 2026-11-19: "Keep on the agent, last" | 01 |
| cofold's `memory` is a plugin option only, last | Softov, 2026-11-19: "Keep, plugin only, last (Recommended)" | 01 |
| Claude's `paths` leaves, and Claude takes the host's | Softov, 2026-11-19: "Remove, use the host's (Recommended)" | 02 |
| A config that still sets Claude's `paths` loads, with a warning in the log | (defaulted: no plugin schema refuses an unknown key, so a config never fails on it) | 02 |
| The claude plugin has a default `model` for a record that names none | Softov, 2026-11-19: "Add a default model (Recommended)" | 02 |
| Claude's `computerConfigDir` is at both levels, on a host record only | Softov, 2026-11-19: "Plugin, computerConfigDir both (Recommended)" | 02 |
| acp gets `portFailures`, with Claude's values `spawn` and `message`, and `spawn` the default | Softov, 2026-11-19: "Add portFailures to acp (Recommended)" | 03 |
| acp's `spawn` sentence is `The agent could not start in computer://<id>.`, and the raw message goes to the daemon's log | (defaulted: acp has no SDK to say one, and the log keeps what the client is not shown) | 03 |
| The order of each form is the table of *Field order* | Softov's answers, 2026-11-19 | 01, 02, 03 |
| Claude's record order is a list in `kindSchema`; `DECLARED` keeps its order | (defaulted: `DECLARED` is the order the options merge in, so moving it could change a value) | 01 |
| `portFailures` covers a session and a terminal; a listing keeps the raw message in the log | (defaulted: a listing's failure is said only in the log, so a short sentence there hides the cause) | 03 |
| A terminal says `The terminal could not start in computer://<id>.` | (defaulted: the sentence names what failed) | 03 |
| A line in the unreleased notes of 0.15.0 | (defaulted: the notes say each change on main) | 01, 02, 03 |

## Field order

The groups in order: Model, Prompt, Tools, Run, Folders and trust, Machines, Tuning.

| Form | Fields |
| --- | --- |
| acp plugin | `hostTools`, `toolsChanged` |
| acp record | `hostTools`, `toolsChanged`, `base`, `command`, `args`, `install`, `page`, `env`, `cwd`, `authenticate`, `honoursTrust`, `machine`, `portFailures`, `cutTurns`, `stderrTail`, `modes`, `unreportedClientCalls`, `findFreshMs`, `listingIdleMs`, `sessionListMaxPages`, `exitGraceMs`, `stderrBytes`, `killGraceMs`, `closeGraceMs` |
| claude plugin | `model`, `hostTools`, `computerExecutable`, `computerCli`, `computerCliFallback`, `computerConfigDir`, `handshakeTimeoutMs` |
| claude record | `models`, `modelSources`, `keepCliModels`, `outputStyle`, `thinking`, `hostTools`, `hostTasks`, `enableTasks`, `env`, `logins`, `extraArgs`, `sandbox`, `computerConfigDir`, `cliStart`, `stopEnds`, `dontAsk`, `portFailures`, `subagentsFrom`, `taskOutputFirstWaitMs`, `taskOutputLongestWaitMs`, `taskOutputQuietReads`, `subagentTitleMax`, `subagentStartTimeoutMs`, `maxShellInitScript`, `maxTerminalOutputBytes`, `keepFramed`, `watchWaitMs`, `fileMostBytes`, `ruleDepth`, `ruleMost` |
| cofold plugin | `model`, `baseUrl`, `apiKey`, `resource`, `models`, `instructions`, `autoCompactTokens`, `autoCompactAt`, `hostTools`, `tools`, `strictTools`, `store`, `computerConfigDir`, `catalogueTimeoutMs`, `memory` |
| cofold record | `baseUrl`, `apiKey`, `resource`, `models`, `instructions`, `autoCompactTokens`, `autoCompactAt`, `hostTools`, `tools`, `store`, `computerConfigDir`, `catalogueTimeoutMs` |
| pi plugin | `model`, `baseUrl`, `apiKey`, `hostTools`, `projectTrust`, `sessionDir` |
| pi record | `baseUrl`, `apiKey`, `hostTools`, `env`, `projectTrust`, `sessionDir` |

## Proposed architecture

- **Data flow** - each form's order is the order of its schema's `properties`. ahpw and the other clients draw that order unchanged.
- **Layer responsibilities** - agent-acp, agent-claude, agent-cofold, agent-pi: the schemas and their tests · docs: each README and the notes.
- **Source-of-truth files** - each plugin's `package.json` `ahpd.optionsSchema`, and each engine's `kindSchema`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the fields follow one order](task-01-the-fields-follow-one-order.md) | done | - |
| [02 - claude takes the host's paths](task-02-claude-takes-the-hosts-paths.md) | done | 01 |
| [03 - acp says a machine failure short](task-03-acp-says-a-machine-failure-short.md) | done | 01 |

## Risks and tradeoffs

- A config that sets Claude's `paths` to folders other than the host's loses them. The warning names the value, so the person can move it to the host's `paths`.
- A test that reads a form's fields in order fails on purpose with each new field, so a new field is placed in its group.

## Resume state

- **Done so far:** tasks 01 to 03, merged in #385 as `f926befca`. See [implemented.md](implemented.md).
- **Next action:** none. Softov closed the plan on 2026-11-19 without the checks by hand, which [deferred.md](deferred.md) holds.
- **Open questions:** none.
- **Watch out for:** a cofold or pi record takes the options' order. A field the record sets again keeps the place of its first key.

## Final verification checklist

- [ ] In ahpw, each agent plugin's options and each agent's form list the fields of *Field order*, in that order.
- [ ] A Claude agent with no `model` starts on the plugin's `model`.
- [ ] An acp agent on a machine that cannot start shows the short sentence, and the log holds the raw message.
- [x] The four agent suites, the sdk suite and the computer suite pass, one at a time. `check` and `check-windows` are green.
