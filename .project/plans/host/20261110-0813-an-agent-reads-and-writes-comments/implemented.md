---
title: An agent reads and writes comments on a session's files - implemented
date: 2026-11-10
refs:
  - git://8ef80cf30
  - "[code://packages/sdk/src/tools/comments.ts](../../../../packages/sdk/src/tools/comments.ts) - the comment tools"
---

ahpd serves VS Code's six comment tools on a session's annotations channel. VS Code draws a comment an agent makes here, and an agent reads one made in VS Code. PR #278 merged it on 2026-11-10.

## What was built

- [`code://packages/sdk/src/tools/comments.ts`](../../../../packages/sdk/src/tools/comments.ts) - `addComment`, `listComments`, `replyToComment`, `deleteComments`, `resolveComments` and `viewUnreviewedComments`. A comment is an annotation with VS Code's `vscode.agentFeedback` meta, written through the same writer as a client's `annotations/*` action.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - a tool that writes needs `session:review`.

## Verified

- `commenttools.test.ts` and `host-tools.test.ts`. CI passed on #278. Not checked by hand in VS Code.

## Departures from the plan

- `viewUnreviewedComments` asks the person in this host's words, since VS Code's question is a client view. No client lets the person pick yet, so yes shows every waiting comment.

## Left for later

- The check by hand in VS Code.
