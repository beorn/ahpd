---
title: cofold reads the cofold names - implemented
date: 2026-11-21
refs:
  - "[code://packages/agent-cofold/src/config.ts](../../../../packages/agent-cofold/src/config.ts) - the resolver name, the project file and the variables"
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - the machine's seed, mount and variable"
  - "[code://packages/agent-acp/src/presets.ts](../../../../packages/agent-acp/src/presets.ts) - `xdgOf` and the copapo preset"
  - npm://@cofold/copapo@0.3.0 - the first copapo that reads the cofold names
---

agent-cofold reads what copapo 0.3.0 reads: `~/.config/cofold/config.json`, `.cofold.json`, `COFOLD_CONFIG` and `COFOLD_*`, and none of the copapo names. A person keeps one file for copapo and for ahpd's cofold agents.

- A cofold machine is seeded with `cofold/config.json`, and `COFOLD_CONFIG` names it.
- The copapo machine profile names `COFOLD_BASE_URL`, `COFOLD_API_KEY`, `COFOLD_MODEL` and `COFOLD_CONFIG`.
- The copapo ACP preset seeds `~/.config/cofold/config.json` into the copapo part, which pins `@cofold/copapo` 0.3.0.
- The program's own names stay copapo: the part, the preset, the binary and the profile.

Where it departs from the plan: the 0.15 notes stay as shipped, because `v0.15.0` read the copapo names. The upgrade lines wait in [deferred.md](deferred.md) for the 0.16 notes.

Verified on 2026-11-21, one package at a time:

- agent-cofold: 327 tests pass; agent-acp: 380; computer: 633; server: 2005; the sdk's `agent-machine-needs.test.ts` passes.
- `pnpm typecheck` and `pnpm boundary` pass.
- The `git grep` of the plan finds only the case that checks the old names are ignored, and the 0.15 notes.
