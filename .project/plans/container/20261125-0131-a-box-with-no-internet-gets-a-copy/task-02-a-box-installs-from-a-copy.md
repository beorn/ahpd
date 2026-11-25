---
title: A box installs from a copy
status: done
depends:
  - task-01-the-host-holds-the-files-of-an-install.md
layer: "computer, docs"
refs:
  - "[code://packages/computer/src/hostinstall.ts#L73-L137](../../../../packages/computer/src/hostinstall.ts#L73-L137) - the script"
  - "[code://packages/computer/src/ssh.ts#L494-L530](../../../../packages/computer/src/ssh.ts#L494-L530) - `installedOn`"
---

## Objective

A box whose download fails and that has no working install is given the files by its host, and installs from them.

## Files

- `UPDATE: packages/computer/src/hostinstall.ts` - the script says the platform, and installs from a copied folder when there is one.
- `UPDATE: packages/computer/src/ssh.ts` - `installedOn` copies and runs the script again.
- `UPDATE: packages/computer/test/computer-hostinstall.test.ts` - the copy cases.
- `UPDATE: docs/plugins/COMPUTERS.md` - *The ahpd on the box* says when a copy is made, and its size.

## Steps

1. Print `platform=<linux-x64 or linux-arm64>` after the platform check.
2. Copy only when the script failed after it named a platform and a root.
3. Send the tar to `<root>/.copy-<key>`, a folder that no install's name matches.
4. Read Node from that folder in the script, and run `npm ci --offline --cache` from it, when the folder is there.
5. Check Node's sum in both cases, and remove the copied folder after the run, passed or failed.
6. Log the copy with the box's name and the reason the download failed.
7. Refuse the session with both reasons when the copy fails too.

## Validation

- A box whose `curl` fails and that has no install gets the copy and starts.
- A box whose `curl` fails and that has an older install runs it, and nothing is copied.
- A copied Node with a wrong sum is refused, and the copied folder is removed.
- A box of another platform is refused before a copy.
- The key is equal with and without a copy.
- Check by hand with a file in `.project/pending/`: a container with sshd and no route out runs a cofold session.

## Resume

Done on 2026-11-25. A container with no network, reached through a stand-in for ssh, got the copy and loaded agent-cofold and agent-pi. Two departures: the script says `npm_config_nodedir`, so node-pty builds with the headers in the copied Node, and curl's connect timeout is 30 s, so a firewalled box fails soon. A box that waits on npm past ten minutes is refused and not copied to. Not run: the check by hand over a real ssh.
