---
title: The host holds the files of an install
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/server/src/install.ts#L80-L125](../../../../packages/server/src/install.ts#L80-L125) - npm started as this Node with `npm-cli.js`"
  - "[code://packages/computer/src/parts.ts#L879-L920](../../../../packages/computer/src/parts.ts#L879-L920) - the tar writer"
---

## Objective

The host makes one folder per install and platform, with the Node download and an npm cache, and writes it as one tar.

## Files

- `CREATE: packages/computer/src/hostcopy.ts` - the folder of an install, filled once and kept, and its tar.
- `UPDATE: packages/computer/src/parts.ts` - `tarEntry` writes a name over 100 bytes as a GNU long name.
- `CREATE: packages/computer/test/computer-hostcopy.test.ts` - the cases.

## Steps

1. Start npm as the server does. Move that code to the sdk when the plugin needs it.
2. Download Node for the platform to a temporary name, check its sha256, and rename it.
3. Fill the npm cache with `npm ci --ignore-scripts` from each lock, with the platform's `--os`, `--cpu` and `--libc`.
4. Remove the scratch folders, and leave a marker when the folder is whole.
5. Make one fill per folder at a time, and remove the folders of other installs.
6. Write a GNU long name entry in `tarEntry` for a name the fixed fields cannot hold.

## Validation

- A second ask for the same install downloads nothing.
- A fill that stopped half way is made again.
- A Node download with another sum is refused, and leaves no folder.
- Two asks at once run one fill.
- The system `tar` reads an archive with a 130 byte name.

## Resume

Done on 2026-11-25. `launch`, which starts npm, moved from the server to the sdk. A copy of another install is removed a week after its last use, not at once, because two daemons of one user may hold two versions. Only a fill by an x64 host for x64 was run to the end; an arm64 cache was only filled.
