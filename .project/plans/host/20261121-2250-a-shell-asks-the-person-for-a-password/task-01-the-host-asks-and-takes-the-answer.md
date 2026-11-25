---
title: The host asks a prompt and takes the answer
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/asking.ts#L135](../../../../packages/sdk/src/host/asking.ts#L135) - `createAsking`, the host's own requests"
  - git://github.com/microsoft/vscode@ddbdd50a9ed1 - `common/meta/vscode/agentShellAuthenticationMeta.ts`, the request; `node/protocolServerHandler.ts#L3865-L3886`, the method
---

## Objective

A prompt that reaches the host's socket becomes VS Code's shell authentication request on its chat, and `vscode/answerShellAuthentication` ends it.

## Files

- `CREATE: packages/sdk/src/host/shellauth.ts` - the socket, the tokens by chat, the prompts in flight, and the request.
- `CREATE: packages/sdk/src/host/askpass.ts` - the helper program, run by Node, that sends the prompt and prints the answer.
- `UPDATE: packages/sdk/src/host/vscodemethods.ts` - `vscode/answerShellAuthentication`.
- `UPDATE: packages/sdk/src/host/gate.ts` - `chat:answer` for the method.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts` - the root setting `shellAuthentication`, off by default.
- `UPDATE: packages/sdk/test/users-gate-tables.test.ts` - the method count.
- `CREATE: packages/sdk/test/shell-authentication.test.ts` - the prompt, the answer and the cancels.

## Steps

1. Open the socket, owner-only, when the setting is on, and close it when the setting goes off.
2. Write the helper's wrappers to the host's own folder: a shell script, and a `.cmd` on Windows.
3. Give each chat a random token, and drop the token when the chat's process ends.
4. Read `{token, prompt}` from the helper, and refuse a token the host does not know.
5. Refuse a helper whose parent process is not `sudo`, `ssh` or `git`.
6. Take `program` from that parent, `inputKind` from the prompt, and `command` from the running tool call.
7. Put the request on the chat through `asking.ts`, as VS Code's `createShellAuthenticationRequest` words it.
8. Cancel at once with no running turn, in autopilot, or with auto-reply on.
9. Answer the helper from `vscode/answerShellAuthentication`, and return `{delivered: false}` for an ended prompt.
10. Cancel the prompt on `chat/inputCompleted`, at the turn's end, and when the helper disconnects.
11. Keep the answer out of chat state, the log and the wire log.

## Validation

- `packages/sdk/test/shell-authentication.test.ts` - a prompt from a fake helper, its request, and the answer back.
- The same file - the cancels, an unknown token, and the setting off.
- The same file - a parent that is not `sudo`, `ssh` or `git`.
- The sdk vitest suite passes.

## Resume
