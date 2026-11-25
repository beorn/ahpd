---
title: The ahpd part is the release's own build - implemented
---

## What exists now

- `scripts/parts-bump.mjs --release <folder>` writes the part's version and both locks from packed tarballs.
- The part's plugins install from a lock, in the image and on a box.
- The release run packs the four packages once. `@ahpd/computer` carries the version and the locks.
- The release job installs the sandbox runtime's tools, which the tests need since #446.

## What was verified

- Dry run 45533551795 of `release.yml` passed `parts`, `release` and `image`. CI and this host packed the same bytes of the four packages.
- The image was built from four packages at 0.99.0, which npm does not serve, and answers that version.
- A box in a container installed both locks from npm and loaded agent-cofold.

## Not done

- The check with an rc, in [pending/the-ahpd-part-of-a-release.md](../../../pending/the-ahpd-part-of-a-release.md).
- A cofold session in a machine with the part.
- The line for `v0_16.md`, which does not exist yet. Task 03 holds it.
