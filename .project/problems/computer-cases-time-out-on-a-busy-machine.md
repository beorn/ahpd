---
title: Computer cases time out on a busy machine
status: mitigated
date: 2026-11-13
severity: minor
blocks: []
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L1616](../../packages/computer/test/computer-devcontainer.test.ts#L1616) - three connects through the fake CLIs, under the default 5 s limit"
  - "[problems/a-disposable-machine-case-fails-at-random.md](a-disposable-machine-case-fails-at-random.md) - the disposable case of the same run"
  - git://0e0fea92b - main when the problem was read
---

## Symptom

Seen on 2026-11-13 on Softov's machine, with a load average of 11 on 8 cores.
In one run of the computer suite these cases timed out at 5000 ms:

- `computer-devcontainer.test.ts`: `finds an adopted container again by its folder, on a second connect and after a restart`
- `computer-devcontainer.test.ts`: `does not hand back an image built without a part the file now has`
- `computer-needs.test.ts`: `makes the machine without a part whose load fails, and refuses only the session that needs it`
- `computer-parts-mount.test.ts`: `writes the time a machine used a part volume into its marker, and again once an hour has passed`
- `computer-plugin.test.ts`: `starts, stops and restarts a machine by writing what it should be`, in a later run with a load average of 8

The adopted container case also timed out alone, on main at `b4ad32951` and on the bot-talk branch, while the load was near 5.

On 2026-11-13 the adopted container case and `reads a dev container's vault-named need again after a restart` timed out alone, at `46cec859d` and at `74b138b73`, with a load average of 1.5. So a busy machine is not the whole cause.

On 2026-11-14, in a full run with a load average near 6, `computer-libvirt.test.ts`: `suspends and resumes a VM through its state, with a stretch closed at each hold` and `computer-state-seed.test.ts`: `seeds a state volume once, again only for a seed that changed, and keeps what the agent wrote` timed out at 5000 ms. Both files passed alone at `0d95f584c`.

On 2026-11-15 the model gateway branch from `804a23937` does not change `packages/computer`.
In its full run, with a load average near 9, four more cases timed out at 5000 ms:

- `computer-devcontainer.test.ts`: `stops the container a folder is, ending the window's relay first`
- `computer-needs.test.ts`: `mounts one state volume for two machines of one profile and owner, and one per owner`
- `computer-parts-mount.test.ts`: `mounts each part from a volume filled once where Docker refuses image mounts`
- `computer-state-seed.test.ts`: `gives the seeded files to the machine’s user, and leaves a root machine’s alone`

A run of those four files at a load average of 7 passed all of them, and timed out on `reads a dev container's vault-named need again after a restart` in their place.

On 2026-11-16, `reads a dev container's vault-named need again after a restart, for the owner in its record` timed out at 5000 ms in a full run, at a load average near 10.

On 2026-11-17 the adopted container case timed out at 5000 ms twice in full runs, at load averages near 9 and near 15. The second run was on host/20261117-2336, which changes only how a test calls git, and the case calls no git.

On 2026-11-18, a computer run at `2946984b6` ran beside a test daemon with Claude turns, at a load average near 12. It timed out on six cases of this file. It also timed out on `computer-uptime.test.ts`: `charges a relay container to whoever connected and metered it from the connect`. The same suite passed alone at a load average near 5.
The branch was host/20261116-1714, which does not change `packages/computer`.

On 2026-11-18, the adopted container case and `reads a dev container's vault-named need again after a restart` timed out at 5000 ms in a full run on host/20261118-1043. They timed out again with the file run alone, on that branch and on host/20261118-1104, which does not change `packages/computer`. The adopted container case passed alone with a 60 s limit, in 6.7 s.

On 2026-11-16, `computer-plugin.test.ts`: `starts, stops and restarts a machine by writing what it should be` timed out at 5000 ms again in a full run, at a load average near 8.
The branch was host/20261116-2126 from `fd236e8ec`, which does not change `packages/computer`.

On 2026-11-13 `computer-disposable.test.ts`: `takes the machine's own git volume with it, and asks for none where the profile leaves it open` timed out alone the same way, at `2bf97a6c1`.


On 2026-11-16, on Softov's machine with a load average near 17, a full run timed out 15 cases in `packages/computer` and `plugin-load.test.ts`. The 8 files run again alone timed out 4 cases, 2 of them not in the first set.

On 2026-11-17, at `acc5b9b9c` with the wrapper change, both cases timed out at 5000 ms again in a full run.
The load average was near 15, while the dev daemon restarted. The change touches only the sdk's command matching.
The two files run alone timed out 3 cases at a load average near 5, the adopted container case among them.
The same 3 timed out on main at `11846b594`, without the change, and CI passed all of them on #363.

On 2026-11-21, CI's `processes (2/2)` on #400 timed out `computer-parts-build.test.ts`: `pulls the joined image by the digest the release pinned for its tag` at 5000 ms. Its cleanup then failed with `ENOTEMPTY` on the build folder. #400 does not change `packages/computer`. The local computer suite passed all 633 cases on its branch.

On 2026-11-21, CI's `windows (4/4)` on #429, run 44942705209, timed out `agent-acp-machine.test.ts`: `reaches a disposable machine: plain values at create, a $secret by name on each command` at 20 s, its `PROCESS_CASE_MS` budget. #429 does not change `packages/agent-acp` or `packages/computer`.

On 2026-11-21, CI's `windows (4/4)` on #426, run 44943835612, timed out the same case at 20 s. #426 does not change `packages/agent-acp` or `packages/computer`.
On 2026-11-22, CI's `windows (4/4)` on #448, run 45066610106, timed out the same case at 20 s. #448 does not change `packages/agent-acp`. Its host check returns before the runtime on Windows.
On Windows that case took 15 s to 17 s when it passed, and the next case, with the same machine, took 2.5 s. The difference is the first import of the computer plugin's source, which took 1.3 s locally. Since `test/the-acp-machine-cases-load-the-computer-plugin-first`, the file imports it once in a `beforeAll`, outside the cases' budget.

On 2026-11-22, the local computer suite under the lock, on branch `build/agents/e5cc1506`, timed out `computer-refusal.test.ts`: `refuses a named machine on a host with no computers port` at 5000 ms. The branch does not change `packages/computer`, and the same file passed on that branch an hour before.

## Cause

Each connect starts the fake `docker` and `devcontainer` CLIs as node processes.
A case with three connects needs more than 5 s when the machine is busy.

## Impact

The suite is red on a busy machine for no fault in the code.

## Workaround

On 2026-11-21, every computer test file that starts the scripted CLIs sets its own budget of `PROCESS_CASE_MS`, 20 s, in [`code://tools/wait.ts`](../../tools/wait.ts). A case that still times out at 20 s is a new sighting here.

## Fix

- Start fewer processes in each case, so the default 5 s is enough again.
