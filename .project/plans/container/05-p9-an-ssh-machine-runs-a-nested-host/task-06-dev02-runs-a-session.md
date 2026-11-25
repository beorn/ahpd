---
title: dev02, set up by hand, runs a session as an ssh machine
status: done
depends: [task-04-the-ssh-fixture-and-tests.md]
layer: "computer (by hand)"
refs:
  - "[code://docs/server/REFERENCE.md](../../../../docs/server/REFERENCE.md) - how ahpd and a plugin are installed"
---

## Objective

dev02 runs ahpd installed by hand, is listed in this host's options as an ssh machine, and a session on it answers a turn, with no hypervisor code anywhere.

## Files

- None in the repository; the configuration used is written into this task's Resume.

## Steps

1. On dev02 (`softov@dev02.example.com`, Debian 13): install Node and `npm i -g @ahpd/server` at this host's version, with `ahpd plugin install` for the agents to test; give it the model key by hand on dev02, never from this host.
2. On this host: `ssh.machines.dev02 = { destination: 'softov@dev02.example.com', workdir: '/home/softov/work' }`.
3. Start a cofold session and a Claude session on `computer://ssh.dev02`; each answers a turn; `ps` on dev02 shows `ahpd --stdio`.
4. `ahpd restart` on this host; each session continues its conversation.
5. Record what failed and what had to be set by hand.

## Validation

- By hand, as above; the Resume names the versions and the config used.

## Resume
Done 2026-10-18, by hand, from a Windows 10 host (Node 24.12.0) to a Debian 13 VM.

**Departure: the box is not dev02.**
dev02's name does not resolve from the Windows host, so the box was a new Debian 13 VM on Proxmox. It is `deb-test` at `softov@10.60.66.4` (VM 201 on `pve-cgr`), with 8 cores and 8 GB.
It is listed as `ssh.deb`.

**Versions.**
- This host: `@ahpd/server` 0.12.0 from npm, with `@ahpd/computer` and `@ahpd/sdk` rebuilt from `v0.12.0` plus this branch's fixes.
- The box: Node v24.22.0 under `/usr/local`, `@ahpd/server` 0.12.0 rebuilt with the `--plugin` fix, and agent-cofold, agent-claude, agent-acp and agent-pi 0.12.0 from npm.
- pi 1.3.0 (`@earendil-works/pi-coding-agent`) and `pi-acp` 0.0.34 on the box.

**The configuration on this host.**
```json
{ "ssh": { "machines": { "deb": {
  "destination": "softov@10.60.66.4",
  "workdir": "/home/softov/work",
  "host": ["sh", "-c", ". \"$HOME/.keys\" && exec ahpd \"$@\"", "ahpd"]
} } } }
```
`host` sources the box's own `~/.keys`, because a non-interactive ssh does not read a profile and the model keys are the box's.
agent-acp on both hosts has `presets: { "pi-acp": { "name": "Pi (ACP)", "command": "pi-acp" } }`, keyed `pi-acp` because agent-pi already holds `pi`: `an-acp-preset-and-a-native-agent-share-one-id.md`, deleted on 2026-11-21 because `96a82a3b2` gave a record a `base` field (last held at `git://c023af02f`).

**Set by hand on the box.**
- This host's public key in `~/.ssh/authorized_keys`, and the box's host key accepted once from this host. `BatchMode=yes` refuses both a password and an unknown key.
- Node 22 or later system-wide, not by nvm, so a non-interactive ssh finds `ahpd`.
- The model keys in `~/.keys`, mode 600.
- cofold: `model: "cofold/deepseek/deepseek-chat"`, `baseUrl: "https://openrouter.ai/api/v1"`, `apiKey: { "$secret": "host:openrouter" }` in the box's vault. cofold splits a model at its first `/`, so the `cofold/` prefix sends OpenRouter the whole `deepseek/deepseek-chat`.
- pi: `~/.pi/agent/settings.json` with `defaultProvider: "openrouter"`, `defaultModel: "~deepseek/deepseek-flash-latest"`.

**What failed, and what fixed it on this branch.**
1. Every agent with a part need was refused: "computer://ssh.deb was made without the part ahpd". `partsMissing` read a Docker label an ssh box never has. Each runtime now answers `parts(id)`, and ssh answers that it mounts none.
2. The host inside skipped agent-acp: "presets is required". A command-line `--plugin` replaced the box's file and its options: [a-plugin-flag-takes-its-options-from-the-file.md](../../../decisions/a-plugin-flag-takes-its-options-from-the-file.md).
3. Every session was handed `file:///C:/home/softov/work`. `nested.ts` wrote the box's folder by this host's path rules. A path that starts with `/` is now written by `posixUriOf`.
4. Every listing, check and session opened an `ssh.exe` console window. The ssh runtime and the nested start now pass `windowsHide`.
5. Every ACP session in a machine was refused as untrusted, because the proxy said nothing about trust: [a-machine-folder-is-trusted-when-the-sessions-folder-is.md](../../../decisions/a-machine-folder-is-trusted-when-the-sessions-folder-is.md).
6. A Windows host trusted no folder at all: `trust.ts` read only paths that start with `/`. It now reads paths by the platform's rules, and compares them without case on Windows.

**Checks.**
- `computer://ssh.deb` is listed in the web UI's machine picker.
- cofold, pi and Claude each answered a turn from the web UI with the box's own `/` and `/home/softov/work`.
- Pi (ACP) answered from a script client that pushes `workspaceTrust`: `Linux deb-test 6.12.113+deb13-amd64`, `/home/softov/work`. From the web UI it is refused, because this host runs `@ahpd/web` 0.4.0, and trust is pushed from 0.5.0 (ahpw `src/bridges/trust.ts`).
- No command line on this host holds a key or a token. The nested `ssh.exe` lines hold the folder, the `sh` wrapper and the plugin name.
- A cofold session told `PELICAN-42`, then `ahpd restart`, then asked from a new connection, answered `PELICAN-42` with both turns held.
- `usage/2026-10-computer.jsonl` holds five stretches for `ssh.deb`, owner `root:DESKTOP-887VL4D`, 3.49 hours, each closed when the daemon stopped.
- `resourceWrite` of `{ "runtime": "ssh" }` to `computer://newbox` and to `computer://ssh.newbox` is refused. The refusal reads "A machine is not made on ssh here; this host makes machines on docker, and ssh is one it only lists".

**Left for others.**
- The Linux gates (`pnpm test`) were not run; on Windows the computer suite fails 144 cases with and without this branch.
- Other spawns open console windows on a Windows daemon: Docker, devcontainer, git, gh and the agents. That belongs with daemon/33.
