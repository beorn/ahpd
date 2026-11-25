---
title: A shell asks the person for a password
domain: host
status: built
priority: medium
created: 2026-11-21
revalidated: 2026-11-21
refs:
  - git://8a5a86a5c - main when the plan was made
  - "[briefs/vscode-methods-ahpd-does-not-serve.md](../../../briefs/vscode-methods-ahpd-does-not-serve.md) - group *Shell authentication*"
  - "[code://packages/sdk/src/host/asking.ts#L135](../../../../packages/sdk/src/host/asking.ts#L135) - the host's own input requests, which this reuses for the prompt"
  - "[code://packages/sdk/src/host/vscodemethods.ts](../../../../packages/sdk/src/host/vscodemethods.ts) - the `vscode/*` handlers"
  - "[code://packages/sdk/src/host/gate.ts#L194](../../../../packages/sdk/src/host/gate.ts#L194) - `chat:answer`, the grant of `chat/inputCompleted`"
  - "[code://packages/sdk/src/types/session.ts#L215](../../../../packages/sdk/src/types/session.ts#L215) - `env`, the environment an agent's own process gets"
  - "[code://packages/sdk/src/tools/shell.ts](../../../../packages/sdk/src/tools/shell.ts) - the host's terminal tool, whose shells get the variables too"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L53](../../../../packages/sdk/src/vscoderootconfig.ts#L53) - the root properties a VS Code client mirrors"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `node/protocolServerHandler.ts#L3865-L3886`, the handler; `common/meta/vscode/agentShellAuthenticationMeta.ts`, the request and its `_meta`; `node/copilot/copilotAgentSession.ts#L10858-L10890`, when a prompt is asked and cancelled; `AGENTS.md#L277`, the rules
---

## Goal

A command an agent runs can ask for a password, a passphrase or a yes or no, as `sudo -A`, `ssh` and `git` do. The person answers in the window, and the answer goes to the command without entering chat state, as in VS Code.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -i "askpass" packages/` - nothing: no shell ahpd starts has a helper for a prompt.
- `rg "answerShellAuthentication|shellAuthentication" packages/` - nothing.

### Runtime path

```
sudo -A / ssh / git -> SUDO_ASKPASS, SSH_ASKPASS, GIT_ASKPASS -> the helper -> the host's local socket, with the chat's token
  -> chat/inputRequested, purpose shellAuthentication, _meta vscode.shellAuthentication
  -> vscode/answerShellAuthentication {chat, requestId, answer?} -> {delivered} -> the helper prints the answer -> the command
```

### Gaps

- VS Code gets the prompt from Copilot's SDK. ahpd's agents have no such hook. So the host gives every process it starts a helper of its own.
- No method answers a prompt outside chat state.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Plan shell authentication | Softov, 2026-11-21, "Plan it (Recommended)" | 01, 02 |
| Every shell and agent ahpd starts gets the helper | Softov, 2026-11-21, "Every shell and agent ahpd starts (Recommended)" | 02 |
| A terminal a person opens gets no helper: it has no turn, so every prompt would be cancelled, and the person answers on the terminal | (defaulted: the review of 2026-11-21) | 02 |
| A `GIT_ASKPASS` or `SSH_ASKPASS` already set in the process's environment is kept | (defaulted: a person's own helper wins) | 02 |
| The helper answers only when its parent process is `sudo`, `ssh` or `git`, and the request shows the running tool call's command | Softov, 2026-11-21, "Check the caller, and show the command (Recommended)" | 01 |
| The parent is read from `/proc` on Linux, `ps` on macOS, and the process table on Windows; `program` is that parent's name, not a guess from the prompt | (defaulted: the check Softov chose) | 01 |
| The socket file and the named pipe are owner-only | (defaulted: only the host's user may reach them) | 01 |
| ahpd only; ahpc and ahpw learn to answer in a later plan, and cancel until then | Softov, 2026-11-21, "ahpd only, the clients later (Recommended)" | - |
| The root setting `shellAuthentication`, off by default; a VS Code client mirrors `chat.agentHost.copilot.shellAuthentication.enabled` | (defaulted: VS Code `AGENTS.md#L277`) | 01 |
| The request has one question, a single choice to cancel with no free text, so a client that does not know the purpose cannot put an answer in chat state | (defaulted: VS Code `createShellAuthenticationRequest`) | 01 |
| `_meta['vscode.shellAuthentication']` carries `program`, `prompt`, `inputKind` (`secret`, `text`, `confirm`) and `command` | (defaulted: VS Code `IShellAuthenticationPrompt`) | 01 |
| A prompt is cancelled at once with no running turn, in autopilot, and with auto-reply; it is cancelled when its turn ends | (defaulted: VS Code `_handleShellAuthenticationRequest`) | 01 |
| `vscode/answerShellAuthentication` needs `chat:answer`; a chat the connection cannot see is refused as `chat must be an Agent Host chat URI` | (defaulted: VS Code L3883, the gate's input grant) | 01 |
| The answer is never logged and never written to the wire log | (defaulted: VS Code redacts it in `ahpJsonlLogger.ts`) | 01 |
| The helper reaches the host over a local socket (a named pipe on Windows), with a token for each chat in the process's environment | (defaulted: Claude's host tools run in process, so there is no endpoint per chat to reuse) | 01 |
| `sudo` reads `SUDO_ASKPASS` only under `-A`; `ssh` gets `SSH_ASKPASS_REQUIRE=force` | (defaulted: the programs' own rules) | 02 |
| A command on a machine (a container, a VM, an SSH host) gets no helper, since it cannot reach the local socket | (defaulted: the socket is local) | 02 |

## Proposed architecture

- **Data flow** - the helper sends `{token, prompt}` to the socket. The host finds the chat by the token, infers `program` and `inputKind`, and asks through `asking.ts`.
- **State flow** - prompts in flight by request id, each with its chat and turn; tokens by chat, dropped when the chat's process ends.
- **Layer responsibilities** - sdk: the socket, the helper, the method and the environment. agent-acp, agent-pi and agent-cofold pass `env` to their processes; agent-claude merges it already.
- **Source-of-truth files** - `packages/sdk/src/host/shellauth.ts`, created here.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host asks a prompt and takes the answer](task-01-the-host-asks-and-takes-the-answer.md) | done | - |
| [02 - Every process ahpd starts gets the helper](task-02-every-process-gets-the-helper.md) | done | 01 |

## Risks and tradeoffs

- A process can pass its environment to a child the person did not expect. The token reaches only its own chat, and a prompt outside a running turn is cancelled.
- The agent holds the token, so it can run the helper itself and ask in sudo's name. On Linux the check refuses a pid that does not hold the helper's end of the connection, and a parent whose resolved executable is not the sudo, ssh or git found on PATH and in the usual system folders when the host started; the kernel does not let a user read the executable of a setuid process, so for a setuid sudo the parent's name is checked. On macOS and Windows only the parent's name is checked, so there the check stops a careless agent, not a deliberate one. Everywhere the shown command is the guard.
- The prompt text comes from the program. It is shown escaped, and the kind it infers decides only whether the window masks the field.

## Resume state

- **Done so far:** tasks 01 and 02, the final checklist, and the caller check. The helper's variables reach a local chat's agent process, the terminal tool's shells, pi's own shell, cofold's shell, Claude's CLI and the ACP server; a person's terminal and anything in a machine get none. On Linux the host refuses a pid that does not hold the helper's end of the connection and a parent that is not the real sudo, ssh or git; on macOS and Windows it checks the parent's name. `pnpm typecheck` and `pnpm boundary` pass. Before the caller check, the sdk, agent-claude, agent-acp and agent-cofold suites, the server and computer suites, and the three named test files passed; those runs predate it. After it, the shell authentication file and agent-pi await a rerun.
- **Next action:** none. Merged as #433, and `built` on Softov's word, 2026-11-23.
- **Open questions:** none.
- **Watch out for:** commit 5692ecf25 alone does not build, because the files it imports arrive in the task 02 commit 2e025b363. A Windows test needs the named pipe path, not a socket file, and the helper's parent through the `.cmd` wrapper is untested. The caller check on macOS and Windows is the parent's name alone, so it stops a careless agent, not a deliberate one; the shown command is the guard.

## Final verification checklist

- [x] A test: the helper's prompt becomes a request with the purpose and `_meta`, and the answer reaches the helper.
- [x] A test: the answer is in no chat action and in no log line.
- [x] A test: a prompt with no running turn, or with the setting off, is cancelled at once.
- [x] A test: Claude's and ACP's processes, and the terminal tool's shells, get the variables while the setting is on.
- [x] The gates pass: typecheck, boundary, and the sdk suite.
