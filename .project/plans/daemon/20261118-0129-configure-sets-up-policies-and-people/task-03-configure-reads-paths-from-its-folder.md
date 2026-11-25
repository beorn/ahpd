---
title: Configure reads its paths from the configuration folder
status: done
depends: [task-01-configure-adds-a-person.md]
layer: "server"
refs:
  - git://a3628d40c - the last commit that holds the problem configure-reads-a-relative-path-from-the-current-folder.md, which this task fixes
  - "[code://packages/server/src/config.ts#L1028-L1050](../../../../packages/server/src/config.ts#L1028-L1050) - `besideFile` and `anchored`, the rule the daemon reads a path key by"
  - "[code://packages/server/src/commands/configure.ts](../../../../packages/server/src/commands/configure.ts) - the token file and the users file that `configure` opens"
---

## Objective

`configure` reads a relative `users` and a relative `connectionTokenFile` against the folder of the configuration file, as the daemon does.
The file keeps each path as it was written.

## Files

- `UPDATE: packages/server/src/config.ts` - `besideFile(file, path)`, which `anchored` now uses for each path key.
- `UPDATE: packages/server/src/commands/configure.ts` - the token file and the users file go through `besideFile`, and a path the file names stays as written.
- `UPDATE: packages/server/test/server-configure.test.ts` - a case for a relative users path and one for a relative token file.
- `DELETE: .project/problems/configure-reads-a-relative-path-from-the-current-folder.md` - this task fixes it.

## Steps

1. Export `besideFile` from `config.ts`, and make `anchored` use it.
2. Open the token file at `besideFile(options.configFile, held.connectionTokenFile)` when the file names one.
3. Set `held.connectionTokenFile` only when the file named none.
4. Open the users file at `besideFile(options.configFile, held.users)` when the file names one.
5. Set `held.users` only when the file named none.
6. Add a case: a relative `users` lists the file's own role and adds the person to that file.
7. Make that case check that the configuration keeps the relative path.
8. Add a case: a relative `connectionTokenFile` keeps the token beside the configuration, and keeps the path as written.

## Validation

- Both cases fail without steps 2 to 5, and pass with them.
- Neither case leaves a file in the folder the suite runs in.
- The server suite passes, run alone as HANDOFF *Tests* says.

## Resume

Built on 2026-11-18, after the check on the test daemon found the flaw. The token half is older than this plan: `configure` read a relative token file from the current folder before task 01.
