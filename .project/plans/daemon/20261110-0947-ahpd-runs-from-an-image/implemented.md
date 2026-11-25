---
title: ahpd runs from an image - implemented
date: 2026-11-10
refs:
  - git://8ff6b7686
  - "[code://Dockerfile](../../../../Dockerfile) - the image, built from the checkout"
  - "[code://docker/entrypoint.sh](../../../../docker/entrypoint.sh) - the plugins and the downgrade check before ahpd runs"
---

ahpd has a Docker image, built from the checkout, with its state in one volume. A Compose file runs it on loopback, and CI builds and checks it on each pull request. PR #283 merged it on 2026-11-10.

## What was built

- [`code://Dockerfile`](../../../../Dockerfile) - packs the workspace with pnpm and installs `@ahpd/server` into `/opt/ahpd` with node-pty compiled. It runs as `ahpd` (uid 1000) under tini with `AHPD_SERVICE=container`, and its health check is `ahpd status --json`.
- [`code://docker/entrypoint.sh`](../../../../docker/entrypoint.sh) - installs the plugins in `AHPD_PLUGINS` into the volume and moves them when the image version changes. It refuses an older image on a newer volume unless `AHPD_ALLOW_DOWNGRADE=1`, then runs ahpd.
- [`code://docker/compose.yaml`](../../../../docker/compose.yaml) - the GHCR image on `127.0.0.1:9187`, with the volume `ahpd-home` and `./work`. [`code://docker/compose.dev.yaml`](../../../../docker/compose.dev.yaml) builds the checkout.
- [`code://.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) - the `image` job builds the image, runs [`code://docker/test/smoke.sh`](../../../../docker/test/smoke.sh), and builds it again from the pull request's GitHub URL.
- [`code://docs/server/DOCKER.md`](../../../../docs/server/DOCKER.md) - the install, the configuration, the backup and the upgrade.
- [docker-checks.md](../../../pending/docker-checks.md) - the LAN and Docker computer checks by hand.

## Verified

- The smoke script passed against the branch. It covers a fresh volume, the token, a restart and `ahpd restart`. It also covers a new container on the same volume, a terminal and a read-only root.
- The `image` job ran on each release since, and passed on the `v0.15.0` release run 44846720007.

## Departures from the plan

- None recorded.

## Left for later

- The upgrade check skipped until a released image was on GHCR. [daemon/20261110-0947-a-release-pushes-the-image](../20261110-0947-a-release-pushes-the-image/plan.md) publishes the image.
- The checks by hand in [docker-checks.md](../../../pending/docker-checks.md).
