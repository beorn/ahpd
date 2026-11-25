---
title: The docs say model gateway
status: done
depends:
  - task-01-the-daemon-reads-model-gateway.md
  - task-02-grants-policy-and-usage-say-gateway.md
layer: "docs"
refs:
  - "[code://docs/server/PROXY.md](../../../../docs/server/PROXY.md) - the page on the model proxy"
  - "[code://docs/server/UPGRADE.md#L77-L88](../../../../docs/server/UPGRADE.md#L77-L88) - *Renamed keys*"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the 0.15 release notes"
  - "[code://.project/plans/proxy/00-proxy.md](../00-proxy.md) - the proxy domain and its words"
---

## Objective

The docs, the READMEs and the specs call it the model gateway, and link to `docs/server/GATEWAY.md`.
The upgrade page and the 0.15 notes say what each old name becomes, and that old names are not read.

## Files

- `CREATE: docs/server/GATEWAY.md` - the page `PROXY.md` was, under the new names.
- `DELETE: docs/server/PROXY.md` - moved to `GATEWAY.md`.
- `UPDATE: docs/server/UPGRADE.md:77-88` - say what each old name becomes, and that old names are not read.
- `UPDATE: docs/updates/v0_15.md` - add an unreleased section at the top with the rename under *Upgrading*.
- `UPDATE: docs/server/CONFIGURE.md` - rename the key, the page link and the words.
- `UPDATE: docs/server/REMOTE.md` - rename the page link and the words.
- `UPDATE: docs/server/USERS.md` - rename the grants and the words.
- `UPDATE: docs/sdk/USERS.md` - rename the grants and the words.
- `UPDATE: docs/sdk/POLICY.md` - rename the value type and the words.
- `UPDATE: docs/sdk/USAGE.md` - rename the usage source and the page link.
- `UPDATE: docs/sdk/HOST.md` - rename the page link and the words.
- `UPDATE: docs/plugins/PLUGINS.md` - rename the page link and the words.
- `UPDATE: docs/README.md` - rename the page link and the words.
- `UPDATE: docs/index.md` - rename the words.
- `UPDATE: docs/.vitepress/theme/HostStory.vue` - rename the words.
- `UPDATE: README.md` - rename the page link and the words.
- `UPDATE: packages/server/README.md` - rename the words.
- `UPDATE: packages/agent-claude/README.md` - rename the page link and the words.
- `UPDATE: .project/specs/http-api-and-proxy.md` - rename the key, the grants and the words.
- `UPDATE: .project/specs/usage.md` - rename the usage source.
- `UPDATE: .project/specs/agent-backends.md` - rename the words.
- `UPDATE: .project/plans/proxy/00-proxy.md` - name the model gateway and its key, grants and command.

## Steps

1. Move `docs/server/PROXY.md` to `docs/server/GATEWAY.md` with `git mv`.
2. Rename the key, the command, the grants, the value type, the source and the words in `GATEWAY.md`.
3. Point every link to `PROXY.md` at `GATEWAY.md`.
4. Rename the names and the words in each file the *Files* list names.
5. Rewrite *Renamed keys* in `UPGRADE.md` with a table of each old name and its new name.
6. Say in *Renamed keys* that the daemon ignores `modelProxy` and `proxy` with a warning, and old grants match nothing.
7. Add `## 0.15.0 - unreleased` at the top of `v0_15.md`, with the same table under `### Upgrading`.
8. Keep the words of `v0_13.md` and `v0_14.md`, and point their links to `PROXY.md` at `GATEWAY.md`.
9. Keep the paths of the specs and of the proxy domain folder.
10. Run `pnpm docs:build`, and fix each dead link.

## Validation

- `git grep -n -i "model proxy\|modelProxy\|proxy:call\|proxy:models\|PROXY.md" -- docs README.md packages .project/specs` finds only `v0_13.md`, `v0_14.md` and the old names in the upgrade tables.
- The docs build passes with no dead link.
- `node <do-spec>/scripts/lint-prose.mjs` passes on `00-proxy.md` and the specs.

## Resume

