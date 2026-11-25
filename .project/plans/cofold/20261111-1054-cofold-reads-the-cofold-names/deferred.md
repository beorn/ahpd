---
title: cofold reads the cofold names - deferred
date: 2026-11-21
---

One thing waits: the upgrade lines, for the release notes of the version that ships this.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A cofold agent reads the harness configuration under cofold's names only. Move `~/.config/copapo/config.json` to `~/.config/cofold/config.json`, rename `.copapo.json` to `.cofold.json`, and rename the `COPAPO_*` variables to `COFOLD_*`, such as `COPAPO_CONFIG` to `COFOLD_CONFIG`. | `v0.15.0` shipped the copapo names, so the 0.15 notes stay as shipped, and a release's notes page is started at its first release candidate | `docs/updates/v0_16.md`, *Upgrading* |
| A cofold or copapo machine made before this release finds no providers, because its state volume holds `copapo/config.json`. Remake the machine. | the same | `docs/updates/v0_16.md`, *Upgrading* |
