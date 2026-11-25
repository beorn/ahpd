---
title: The model proxy is the model gateway
domain: proxy
status: built
priority: high
created: 2026-11-15
revalidated: 2026-11-15
requires: []
changes:
  - specs/http-api-and-proxy.md
  - specs/usage.md
  - specs/agent-backends.md
refs:
  - git://22d0e1e97 - the last commit that holds the brief `briefs/the-model-proxy-is-the-model-gateway.md`, which this plan covers
  - git://v0.14.0 - the last release, which holds every name this plan renames
  - "[code://packages/server/src/config.ts#L613](../../../../packages/server/src/config.ts#L613) - the `modelProxy` key of `Config`"
  - "[code://packages/server/src/config.ts#L1000-L1003](../../../../packages/server/src/config.ts#L1000-L1003) - `RENAMED_KEYS`, which reads `proxy` as `modelProxy`"
  - "[code://packages/server/src/commands/options.ts#L990-L994](../../../../packages/server/src/commands/options.ts#L990-L994) - the `modelProxy` field and its title"
  - "[code://packages/server/src/commands/options.ts#L1036](../../../../packages/server/src/commands/options.ts#L1036) - `FILE_ONLY`"
  - "[code://packages/server/src/commands/options.ts#L1299-L1300](../../../../packages/server/src/commands/options.ts#L1299-L1300) - the check of the key past the schema"
  - "[code://packages/server/src/commands/options.ts#L1518](../../../../packages/server/src/commands/options.ts#L1518) - where a run reads the key"
  - "[code://packages/server/src/rootconfig.ts#L38](../../../../packages/server/src/rootconfig.ts#L38) - `DAEMON_KEYS`, the keys a client edits"
  - "[code://packages/server/src/commands/run.ts#L718](../../../../packages/server/src/commands/run.ts#L718) - the run hands the key to the listener"
  - "[code://packages/server/src/proxy/providers.ts#L67-L191](../../../../packages/server/src/proxy/providers.ts#L67-L191) - the key's checks and their messages, `PROVIDERS_GONE` included"
  - "[code://packages/server/src/commands/proxy.ts#L41-L55](../../../../packages/server/src/commands/proxy.ts#L41-L55) - the `proxy.list` command"
  - "[code://packages/sdk/src/access/users.ts#L35](../../../../packages/sdk/src/access/users.ts#L35) - the built-in `member` role, with `proxy:read` and `proxy:write`"
  - "[code://packages/sdk/src/access/users.ts#L71-L74](../../../../packages/sdk/src/access/users.ts#L71-L74) - the `proxy` subject"
  - "[code://packages/sdk/src/access/users.ts#L235-L244](../../../../packages/sdk/src/access/users.ts#L235-L244) - the subject's title `Model proxy`, beside `MCP gateway`"
  - "[code://packages/sdk/src/access/users.ts#L1240-L1282](../../../../packages/sdk/src/access/users.ts#L1240-L1282) - a team key answers only its two grants"
  - "[code://packages/sdk/src/access/users.ts#L1766-L1782](../../../../packages/sdk/src/access/users.ts#L1766-L1782) - the grants a team key is minted with"
  - "[code://packages/sdk/src/access/tokens.ts#L155-L160](../../../../packages/sdk/src/access/tokens.ts#L155-L160) - minting a team key needs `proxy:call`"
  - "[code://packages/server/src/commands/token.ts#L255](../../../../packages/server/src/commands/token.ts#L255) - the same bound on `ahpd token`"
  - "[code://packages/server/src/proxy/listener.ts#L756](../../../../packages/server/src/proxy/listener.ts#L756) - a model call asks for `proxy:call`"
  - "[code://packages/server/src/proxy/listener.ts#L1182-L1202](../../../../packages/server/src/proxy/listener.ts#L1182-L1202) - a model call's usage record, `source: 'proxy'`"
  - "[code://packages/sdk/src/access/policies.ts#L38-L44](../../../../packages/sdk/src/access/policies.ts#L38-L44) - the `proxy` value type of a `model` policy"
  - "[code://packages/sdk/src/access/decide.ts#L59](../../../../packages/sdk/src/access/decide.ts#L59) - the same values where a policy is decided"
  - "[code://packages/sdk/src/types/policies.ts#L41](../../../../packages/sdk/src/types/policies.ts#L41) - `PolicyValueType`"
  - "[code://packages/sdk/src/types/usage.ts#L41](../../../../packages/sdk/src/types/usage.ts#L41) - the usage sources"
  - "[code://packages/server/test/config-check.test.ts#L195-L209](../../../../packages/server/test/config-check.test.ts#L195-L209) - an unknown key is warned about and ignored"
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the page on the model proxy"
  - "[code://docs/server/UPGRADE.md#L77-L88](../../../../docs/server/UPGRADE.md#L77-L88) - *Renamed keys*, which says `proxy` still starts and the grants keep their names"
  - "[code://.project/plans/daemon/34-the-api-and-proxy-keys-get-their-own-names/plan.md](../../daemon/34-the-api-and-proxy-keys-get-their-own-names/plan.md) - the rename of `proxy` to `modelProxy`, the pattern this plan mirrors"
---

## Goal

ahpd calls the model proxy the model gateway, in every name a person reads, types or stores.
The config key, the command, the route, the grants, the policy value and the usage source all say gateway.
No old name is read: a host that updates from 0.14 edits its files by hand, as the upgrade page says.
ahpw follows in its own plan, `hosts/20261115-1356-the-model-gateway-section` in the ahpw repository.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n modelProxy -- packages` - 22 lines in `config.ts`, `options.ts`, `rootconfig.ts`, `run.ts`, `commands/proxy.ts`, `proxy/listener.ts` and `proxy/providers.ts`, and 54 lines in 7 server test files.
- `git grep -c "proxy:call\|proxy:models" -- packages` - `tokens.ts`, `users.ts`, `types/users.ts`, `token.ts` and `listener.ts`, and 68 lines in 9 test files.
- `git grep -n "'proxy'" -- packages` - the subject, the policy value type, the usage source and the command's CLI pattern.
- `git grep -n -i "model proxy" -- packages scripts` - titles in `users.ts` and `options.ts`, and comments in `agent-claude`, `sdk/src/connectors` and `server/src/proxy`.
- `git grep -n -i gateway -- packages docs` - `MCP gateway` is the `mcp` subject's title. The other uses are Docker's `host-gateway` and third-party gateways.
- `git grep` of each name at `v0.13.0` and `v0.14.0` - every name is in both releases.

### Runtime path

```
config.json modelGateway -> config.ts -> options.ts check -> run.ts -> listener at /v1 and the root paths
tool call -> callerOf(gateway:call) -> route -> provider -> ModelUse source 'gateway' -> usage records
ahpd gateway list | GET /gateway/list -> commands/proxy.ts -> the model names and their providers
```

### Gaps

- A name the host shows says proxy, though the thing is a gateway beside the `MCP gateway`.
- `RENAMED_KEYS` still reads `proxy`, the name before 0.13.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Every layer is renamed: config key, command and route, grants, policy value, usage source and words | Softov, 2026-11-15: "All layers. It does not need migration." | 01, 02, 03 |
| No old name is read, and nothing rewrites a file or a record | Softov, 2026-11-15, chose "No migration, old names break" after he was told the names shipped in 0.13 and 0.14 | 01, 02, 03 |
| `RENAMED_KEYS` loses its `proxy` row and gets no `modelProxy` row | (defaulted: no old name is read) | 01 |
| The key is `modelGateway`, with `models`, `sessionCalls` and `keyRefusal` unchanged under it | the brief, which Softov had committed on 2026-11-15 | 01 |
| The command is `gateway.list`, at `ahpd gateway list` and `GET /gateway/list` | the brief | 01 |
| `PROVIDERS_GONE` and every message that names the key name `modelGateway` | (defaulted: a message names the key a person writes) | 01 |
| The subject is `gateway`, titled `Model gateway`, with `gateway:call`, `gateway:models`, `gateway:read` and `gateway:write` | the brief | 02 |
| The built-in `member` role holds `gateway:read` and `gateway:write` | (defaulted: it held the proxy's two groups) | 02 |
| The policy value type is `gateway`, and a model call's usage record says `source: 'gateway'` | the brief | 02 |
| The code keeps its own names: `packages/server/src/proxy/`, `proxyHandler`, `ProxyOptions`, `PROXY_PREFIX` and the test files | Softov saw this scope in the table of layers on 2026-11-15 | 01, 02 |
| The nested session proxy keeps its name | the brief: it is a different thing | 02 |
| `docs/server/PROXY.md` becomes `docs/server/GATEWAY.md`, and every link follows | the brief | 03 |
| An unreleased section at the top of `v0_15.md` says what each old name becomes, under *Upgrading* | (defaulted: `v0_15.md` took an unreleased 0.14.1 section before, and the bump PR folds it in) | 03 |
| `v0_13.md` and `v0_14.md` keep their words | the brief: they say what those releases did | 03 |
| This session builds the plan | Softov, 2026-11-15, chose "Brief, then plan, then I build" | 01, 02, 03 |

## Proposed architecture

- **Data flow** - `config.ts` declares `modelGateway`, and `options.ts` returns it as `modelGateway`. The rest reads that name.
- **Event flow** - Unchanged.
- **State flow** - Files and records keep what they hold. A key or grant with the old name matches nothing.
- **Layer responsibilities** - `packages/server` owns the key, the command and the listener. `packages/sdk` owns the grants, the policy value and the types. `docs` owns the page and the upgrade text.
- **Source-of-truth files** - [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) and [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the daemon reads modelGateway](task-01-the-daemon-reads-model-gateway.md) | done | - |
| [02 - grants, policy and usage say gateway](task-02-grants-policy-and-usage-say-gateway.md) | done | - |
| [03 - the docs say model gateway](task-03-the-docs-say-model-gateway.md) | done | 01, 02 |

## Risks and tradeoffs

- A 0.14 host loses its model table at start, with only the unknown-key warning. The upgrade page says what to rename.
- A role or team key with an old grant loses model calls with no error. The upgrade page lists the old grants.
- Old usage records keep `source: 'proxy'`, which the type no longer names. No code reads the source by value today.
- A fork branch from before 2026-11-02 that is merged later brings old names back. Its review greps them.
- The sdk changes, so the computer suite runs as well as the sdk and server suites.

## Resume state

- **Done so far:** tasks 01 to 03, 2026-11-15, in one PR that waits for Softov's review.
- **Next action:** none, the plan is built.
- **Open questions:** none.
- **Departures:** the policy match field and the decision's `Asked` field are `gateway` too, and a refusal says `through gateway <provider>`. The policy form labels the field `Gateway providers`. The daemon log lines of the listener still start with `proxy:`.
- **Found:** a stored policy row that matches `proxy` is skipped at read, so a deny row of it refuses nothing. The upgrade page and the 0.15 notes say so.
- **Watch out for:** `proxy` also names the nested session proxy and the outgoing `HTTP_PROXY` variables. Rename only the model gateway's names.

## Final verification checklist

- [ ] A file with `modelGateway` starts, serves its model names, and warns about nothing.
- [ ] A file with `modelProxy` or `proxy` starts with the unknown-key warning and no model table.
- [ ] `ahpd gateway list` and `GET /gateway/list` list the model names, and `ahpd proxy list` is unknown.
- [ ] A role with `gateway:call` calls a model, and a role with only `proxy:call` is refused.
- [ ] A team key is minted with `gateway:call`, and its call is charged with `source: 'gateway'`.
- [ ] `git grep -n -i "modelProxy\|proxy:call\|proxy:models\|model proxy"` finds only `v0_13.md`, `v0_14.md`, `.project` history and the upgrade text.
- [ ] The sdk, server and computer suites pass, one at a time, and the typecheck is clean.
