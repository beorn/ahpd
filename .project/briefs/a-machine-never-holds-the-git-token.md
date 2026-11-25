---
title: A machine never holds the git token
created: 2026-10-31
refs:
  - git://4e122781 - the commit of ahpd the facts were checked at
  - git://171e90619c7 - the commit of VS Code the facts were checked at
  - git://99756e22 - the commit that took the git credential out of a `clone` machine
  - git://9a53c503 - the commit that gave a `clone` machine a git credential from the vault, before 99756e22 took it out
  - "[code://.project/plans/container/05-p8-a-profile-on-another-docker/deferred.md#L13](../../.project/plans/container/05-p8-a-profile-on-another-docker/deferred.md#L13) - a `clone` machine for a private repository waits for access its agent cannot read"
  - "[code://packages/computer/src/clone.ts#L67-L105](../../packages/computer/src/clone.ts#L67-L105) - `originOf` drops a user and password from the origin, and `httpsOf` turns an ssh origin into https"
  - "[code://packages/computer/src/machinegit.ts#L153-L186](../../packages/computer/src/machinegit.ts#L153-L186) - `fetchedInto`, the `clone` fetch, with no credential"
  - "[code://packages/computer/src/secrets.ts#L95-L122](../../packages/computer/src/secrets.ts#L95-L122) - `revealed`, which reads a need's `$secret` for the machine's owner and team"
  - "[code://packages/computer/src/secrets.ts#L165-L174](../../packages/computer/src/secrets.ts#L165-L174) - `scopedTo`, which gives an agent's command only the vault variables its needs declare"
  - "[code://packages/computer/src/plugin.ts#L977-L1030](../../packages/computer/src/plugin.ts#L977-L1030) - `vaulted` and `namedFor`: vault values live in the daemon and go on each command"
  - "[code://packages/computer/src/byname.ts#L1-L54](../../packages/computer/src/byname.ts#L1-L54) - `byName`: a value goes as `-e NAME` with the value in the `docker` program's environment"
  - "[code://packages/computer/src/runtime.ts#L1342-L1345](../../packages/computer/src/runtime.ts#L1342-L1345) - `madeWith`, the variables a machine is made with, less the vault ones"
  - "[code://packages/computer/src/runtime.ts#L3144-L3147](../../packages/computer/src/runtime.ts#L3144-L3147) - `docker run` gets no vault value, so the container's record holds none"
  - "[code://packages/computer/src/vm.ts#L490-L491](../../packages/computer/src/vm.ts#L490-L491) - a VM refuses any environment need"
  - "[code://packages/computer/src/libvirt.ts#L234](../../packages/computer/src/libvirt.ts#L234) - a libvirt VM is on the `network` option, `default` when absent"
  - "[code://packages/computer/src/proxmox.ts#L235](../../packages/computer/src/proxmox.ts#L235) - a Proxmox VM's card is on the `bridge` option"
  - "[code://packages/sdk/src/types/machine.ts#L55-L63](../../packages/sdk/src/types/machine.ts#L55-L63) - the `credential` mark on a need"
  - "[code://packages/server/src/proxy/listener.ts#L113-L169](../../packages/server/src/proxy/listener.ts#L113-L169) - the headers that never go upstream, and `upstreamHeaders`, which sets the connector's key"
  - "[code://packages/server/src/proxy/listener.ts#L654-L668](../../packages/server/src/proxy/listener.ts#L654-L668) - `refusedGuard`: a loopback `Host` at any port is allowed, for a forward"
  - "[code://packages/server/src/proxy/listener.ts#L782-L791](../../packages/server/src/proxy/listener.ts#L782-L791) - the connector's key, read per call"
  - "[code://packages/server/src/proxy/listener.ts#L448](../../packages/server/src/proxy/listener.ts#L448) - `refusalWords`, which removes the key from a refusal it reports"
  - "[code://packages/server/src/proxy/caller.ts#L72-L103](../../packages/server/src/proxy/caller.ts#L72-L103) - `credentialOf` and `callerOf`: the ahpd token a caller presents, and `whose` for a session's token"
  - "[code://packages/server/src/proxy/dialects.ts#L285-L286](../../packages/server/src/proxy/dialects.ts#L285-L286) - `keyHeader`, the header the real key goes in"
  - "[code://packages/server/src/commands/run.ts#L596-L625](../../packages/server/src/commands/run.ts#L596-L625) - the proxy's options, with no `whose`"
  - "[code://docs/server/PROXY.md#L85](../../docs/server/PROXY.md#L85) - a session's token works only when the host hands sessions one"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/missionControl/missionControlProjects.ts#L365-L397 - the agent host's clone, with an inline credential helper and the token in `VSCODE_MC_GIT_TOKEN`
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4238-L4245 - the Copilot CLI gets the token in `GITHUB_COPILOT_GITHUB_TOKEN` and `GH_ENTERPRISE_TOKEN`
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/missionControl/MISSION_CONTROL.md#L145 - "this is not a sandbox against machine-owned Git credentials"
  - https://github.com/microsoft/vscode/blob/171e90619c7/extensions/git/src/askpass.ts#L37-L101 - the git extension's `GIT_ASKPASS`, which answers git with a credential from a provider
  - https://git-scm.com/docs/gitcredentials - credential helpers and their `get`, `store` and `erase`, read on 2026-10-31
  - https://git-scm.com/docs/git-config - `http.extraHeader`, `http.proxy`, `http.sslCAInfo`, `url.<base>.insteadOf`, `credential.helper` and `GIT_CONFIG_COUNT`, read on 2026-10-31
  - https://cli.github.com/manual/gh_help_environment - `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GH_HOST`, read on 2026-10-31
  - https://docs.gitlab.com/cli/configuration/ - glab's token, host, API host, protocol, CA and proxy settings, read on 2026-10-31
  - https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation - a token as the git password, and `Authorization: Bearer` for the API, read on 2026-10-31
  - https://docs.gitlab.com/user/profile/personal_access_tokens/ - a token as the git password, and `PRIVATE-TOKEN` for the API, read on 2026-10-31
  - git://817615bc:.project/briefs/a-proxy-key-names-what-it-charges.md - the model proxy brief, the sibling a forge proxy copies
---

# A machine never holds the git token

Softov's goal, in his words: "Git token held by a proxy".
A session's machine uses a GitHub or GitLab token for `git`, `gh` or `glab`.
That token stays on the host side.
A proxy adds it to each request to the forge, so the code that runs in the machine never sees it.

## What others do

### VS Code's agent host

- The Mission Control clone runs `git clone` on the agent host itself, not in a machine.
- For a github.com or Enterprise origin it puts the token in `VSCODE_MC_GIT_TOKEN` in the environment of that `git` process.
- It adds an inline helper, `credential.<origin>.helper`, that prints `username=x-access-token` and the token as the password. It sets the helper with `-c` or with `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>`.
- The Copilot CLI gets the token in `GITHUB_COPILOT_GITHUB_TOKEN`, and in `GH_ENTERPRISE_TOKEN` for an Enterprise host.
- `MISSION_CONTROL.md` says that normal Git configuration stays available, and "this is not a sandbox against machine-owned Git credentials".
- No forge proxy is in `src/vs/platform/agentHost`. A search for `askpass`, `credential.helper` and `extraheader` there finds only the clone.

### VS Code's git extension

- The extension sets `GIT_ASKPASS` to a script that asks the extension over IPC.
- The extension asks each credentials provider and answers with the username and password. So the token reaches the `git` process.

### Git

- A credential helper is a program git runs with `get`, `store` or `erase`. For `get` it prints `username` and `password` on stdout, and git sends them to the server.
- `credential.helper` may be a shell command after `!`. `credential.<url>.*` applies a setting to one URL only.
- `http.extraHeader` adds a header to every request to a server. `http.<url>.*` applies a setting to one URL.
- `url.<base>.insteadOf` rewrites any URL that starts with its value to start with `<base>`. The longest match wins.
- `http.proxy` overrides `http_proxy`, `https_proxy` and `all_proxy`. The docs say a proxy "must be completely transparent".
- `http.sslCAInfo`, or `GIT_SSL_CAINFO`, names the CA file git checks the server with.

### gh and glab

| Tool | Token | Host | Other |
|---|---|---|---|
| `gh` | `GH_TOKEN`, then `GITHUB_TOKEN`, for github.com and `*.ghe.com`; `GH_ENTERPRISE_TOKEN`, then `GITHUB_ENTERPRISE_TOKEN`, for Enterprise Server | `GH_HOST` | The environment page names no proxy or CA setting |
| `glab` | `GITLAB_TOKEN`, then `GITLAB_ACCESS_TOKEN`, then `OAUTH_TOKEN` | `GITLAB_HOST`, then `GL_HOST`, then `GITLAB_URI` | `GITLAB_API_HOST`, `GLAB_API_PROTOCOL` (`http` or `https`), `GLAB_CA_CERT`, `GLAB_PROXY`; `custom_headers` only in `config.yml` |

### The forges

- GitHub takes a token as the git password, as in `https://x-access-token:TOKEN@github.com/...`. Its API takes `Authorization: Bearer <token>` at `api.github.com`.
- GitLab takes a personal access token as the git password, with any non-empty username. Its REST API takes the `PRIVATE-TOKEN` header.

## What ahpd has today

### A git credential in a machine

- No git or forge token reaches a machine at `git://4e122781`.
- A `clone` machine on another Docker fetches the session's branch from `origin` with no credential, so only a public repository works ([`code://packages/computer/src/machinegit.ts`](../../packages/computer/src/machinegit.ts#L153-L186)).
- `originOf` removes a user and a password from an `https` origin, and `httpsOf` turns an ssh origin into its https form ([`code://packages/computer/src/clone.ts`](../../packages/computer/src/clone.ts#L67-L105)).
- Commit `9a53c503` gave a `clone` machine a vault secret named in the profile's `gitCredential`. It went as `AHPD_GIT_CREDENTIAL` in the environment of two `docker exec` commands, read by an inline `credential.helper`.
- Commit `99756e22` removed it. The deferred row says why: "a key or token in the machine is one everything running there can read" ([`code://.project/plans/container/05-p8-a-profile-on-another-docker/deferred.md`](../../.project/plans/container/05-p8-a-profile-on-another-docker/deferred.md#L13)).
- No agent declares `GH_TOKEN`, `GITHUB_TOKEN` or `GITLAB_TOKEN` as a need. The Copilot agent declares `COPILOT_GITHUB_TOKEN`, as a secret variable.
- A need marked `credential` is refused on another box when its value is this host's own default ([`code://packages/sdk/src/types/machine.ts`](../../packages/sdk/src/types/machine.ts#L55-L63)).

### A vault value in a machine

- A need's value written `{ "$secret": "<name>" }` is read from the vault for the machine's owner and team ([`code://packages/computer/src/secrets.ts`](../../packages/computer/src/secrets.ts#L95-L122)).
- Only a need that an agent on the machine declares is read.
- `docker run` gets no vault value, so the container's record holds none ([`code://packages/computer/src/runtime.ts`](../../packages/computer/src/runtime.ts#L3144-L3147)).
- The daemon keeps vault values in memory in `vaulted`, and gives them on each command into the machine ([`code://packages/computer/src/plugin.ts`](../../packages/computer/src/plugin.ts#L977-L1030)).
- An agent's command gets only the vault variables that its own needs declare ([`code://packages/computer/src/secrets.ts`](../../packages/computer/src/secrets.ts#L165-L174)).
- Each value goes as `-e NAME`, with the value in the environment of the `docker` program, so it is in no argv ([`code://packages/computer/src/byname.ts`](../../packages/computer/src/byname.ts#L1-L54)).
- Inside the machine the value is in the environment of that command and of its children.

### The model proxy

- The proxy is served under `/v1` on the listener that carries `/api`, while `httpApi` is on.
- A caller presents an ahpd token as `Authorization: Bearer` or `x-api-key` ([`code://packages/server/src/proxy/caller.ts`](../../packages/server/src/proxy/caller.ts#L72-L103)).
- `callerOf` checks the deployment token, then a session's token through `whose`, then a person or a team key.
- `authorization`, `x-api-key`, `cookie`, `host` and every `x-ahp-*`, `x-forwarded-*` and `proxy-*` header never go upstream ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L113-L169)).
- `upstreamHeaders` then sets the connector's own key in `keyHeader`: `x-api-key` for Anthropic, `Authorization: Bearer` for the rest ([`code://packages/server/src/proxy/dialects.ts`](../../packages/server/src/proxy/dialects.ts#L285-L286)).
- The connector's key is read per call ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L782-L791)). `refusalWords` removes it from a refusal it reports ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L448)).
- A `Host` of the API's names, or a loopback name at any port, is allowed, so a forward from a machine elsewhere reaches it ([`code://packages/server/src/proxy/listener.ts`](../../packages/server/src/proxy/listener.ts#L654-L668)).
- `run.ts` builds the proxy's options with no `whose` ([`code://packages/server/src/commands/run.ts`](../../packages/server/src/commands/run.ts#L596-L625)). So no session's token is answered, as `PROXY.md` says ([`code://docs/server/PROXY.md`](../../docs/server/PROXY.md#L85)).
- Nothing in `packages/computer` gives a machine the proxy's URL, a token for it, or a forward to it.

### The network of a machine

- `docker run` gets no `--network` flag, so a container is on Docker's default network.
- No code in `packages/computer` sets `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` or an egress rule for a machine.
- A libvirt VM is on the libvirt network that the `network` option names, `default` when absent ([`code://packages/computer/src/libvirt.ts`](../../packages/computer/src/libvirt.ts#L234)).
- A Proxmox VM's card is on the `bridge` option ([`code://packages/computer/src/proxmox.ts`](../../packages/computer/src/proxmox.ts#L235)).
- A VM refuses any environment need, so a vault value cannot reach one ([`code://packages/computer/src/vm.ts`](../../packages/computer/src/vm.ts#L490-L491)).

## Who writes

| Writer | Files | Effect of the change |
|---|---|---|
| ahpd `origin/main`, at `4e122781` | The files in the refs | The change starts here. |
| Open PR #165, `claude/20261031-0228-a-skill-names-its-own-file`, worktree `skills-file` | No file of `packages/computer` or `packages/server/src/proxy` | None. |
| `claude/20261031-0258-a-written-agent-shows-at-once`, worktree `agent-reload` | Committed and uncommitted: `packages/agent-claude` and `packages/sdk/src/host.ts`, `types/agent.ts` | None. |
| `origin/host/20261030-1608-a-targeted-token-reaches-only-its-server` | No file of `packages/computer` or `packages/server/src/proxy` | None. |
| `maycxc/*` branches, eight not merged | Only `maycxc/host/124-...` touches `packages/sdk/src/machines`, the terminal files | None. |
| Worktree `review-maycxc-union`, detached at `e03c0e67` | No file of `packages/computer` or `packages/server/src/proxy` | None. |
| Worktrees `release-prerelease` and `vm` | No commit ahead of `origin/main`, and no uncommitted change | None. |
| Worktree `build-agents-fda88f4a` | Uncommitted, from 2026-10-18: `computer/src/manifest.ts`, `plugin.ts`, `provider.ts`, `router.ts`, `runtime.ts` and `sdk/src/types/machine.ts` | The old p8 work, which refuses a credential need on another Docker. It does not touch `secrets.ts`, `clone.ts`, `machinegit.ts` or the proxy. A change to `runtime.ts` or `plugin.ts` conflicts with it if it is ever merged. |
| `/github/ahpd`, local `main` at `1965724e` | Untracked briefs only | None. |

## The change

- The forge token is a vault secret, or a host setting, and it stays in the daemon.
- A machine's `git`, `gh` and `glab` reach GitHub or GitLab through a proxy on the host side, which adds the token to each request.
- Nothing in the machine holds the token: no variable, no git config entry, no file.
- The proxy copies the shape of the model proxy. The machine presents a stand-in credential that names its session, and the proxy removes it and sets the real token.
- A stand-in credential works only for the session it was made for, and only while the session is open.
- The proxy sends a request only to the forge hosts that its configuration names.
- A proxy can add the token in one of two ways. Each needs this:

| Way | What the machine needs | What the proxy needs |
|---|---|---|
| An HTTPS forward proxy that ends TLS for the forge hosts only | `HTTPS_PROXY`, or `http.proxy` for git and `GLAB_PROXY` for glab; a CA that it trusts, through `http.sslCAInfo` or `GIT_SSL_CAINFO` for git and `GLAB_CA_CERT` for glab | A CA and a certificate for each forge host; the token in the git password or the API header of each request |
| A host-side HTTP endpoint, with no TLS interception | `url.<base>.insteadOf` from the forge URL to the endpoint for git; `GH_HOST` for gh; `GITLAB_API_HOST` and `GLAB_API_PROTOCOL` for glab | An endpoint per forge that sends each request on to the forge over TLS with the token |

## Open points

- Which of the two ways the proxy uses, or whether it offers both as a setting.
- Whether a sandboxed chat on this host uses the sandbox runtime's own way: `credentials` with `network.tlsTerminate` add the token at the sandbox's proxy. Not checked against this brief's facts. It needs [plans/container/20261121-2250-a-chat-sandbox-trusts-a-host-ca](../plans/container/20261121-2250-a-chat-sandbox-trusts-a-host-ca/plan.md) for the CA that termination signs with.
- Whether `git push` from the machine goes through the proxy, or the host pushes after bring-back.
- Where the proxy listens, and how a machine on another box reaches it. Today no route goes from a machine to the host's `/v1`.
- Whether a token is one per host, per person or per team, and how it is scoped to a repository.
- Whether the stand-in credential is the session's ahpd token, which `whose` would answer.
- Not checked: whether `gh` reads `HTTPS_PROXY` and a CA file from the environment. Its environment page names neither.
- Not checked: whether `gh` can reach a host-side endpoint over plain `http` through `GH_HOST`.
- Not checked: whether GitHub and GitLab take the token over git HTTPS as an `Authorization` header from `http.extraHeader`. Their docs show it only as the password.
- Not checked: whether a host directory with a forge login, such as `~/.config/gh`, reaches a machine through a profile's `mounts`.
- Not checked: whether the host's own git config reaches a machine through the mounted git directory.
