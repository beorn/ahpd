---
title: A box with no internet gets a copy - implemented
---

## What exists now

- [`code://packages/computer/src/hostcopy.ts`](../../../../packages/computer/src/hostcopy.ts) fills and keeps the files of an install, and writes them as one tar.
- The box script names its platform, and installs from `.copy-<key>` when it is there.
- `installedOn` sends the files when the script failed after it named a platform.
- [`code://packages/sdk/src/utils/npm.ts`](../../../../packages/sdk/src/utils/npm.ts) holds `launch`, which the server exported before.

## What was verified

- The computer suite and the server's install cases pass on Linux.
- A container with no network installed ahpd from the copy in 40 s, the download by the host included. It loaded agent-cofold and agent-pi. A second ask took 0.2 s.

## Where it departed from the plan

- A copy is kept for a week after its last use, not only for the current install.
- The script points npm at the headers in the copied Node, because node-pty otherwise asks nodejs.org for them.
- curl gives a connection 30 seconds.

## Not done

- The check over a real ssh, in [pending/a-box-with-no-internet.md](../../../pending/a-box-with-no-internet.md).
- An install on an arm64 box.
