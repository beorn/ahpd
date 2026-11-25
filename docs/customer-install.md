# Customer host install: one command, no root, no Nix, no Docker

Operator, 2026-11-24: installing Nix is "a big ask", "even bigger than Docker"; Nix stays on our machines and in the
cloud (@cto 36d97490). A customer's machine therefore gets one folder the user owns, one boot item in the user's own
session, and downloads pinned to an exact version and checked against a published checksum before use.

The installer must work on a stock Mac or Linux box with no root, no Nix, no Docker, and without using the customer's
own Node.

## What it creates

Everything lives under `~/.ahpd` (`AHPD_HOME` overrides it), and the release folders are `@ahpd/deploy`'s own layout,
so versions, switch-back and pruning are that package's code and not a second copy (#38276, #38280).

| Path | What it is |
| --- | --- |
| `~/.ahpd/` | the one folder this install owns |
| `~/.ahpd/state/` | the daemon's state: sessions, records, the deploy journal |
| `~/.ahpd/state/deploy/ahpd/releases/<version>/` | one folder per release: `runtime`, `ahpd`, `host-plugin`, `supervisor` |
| `~/.ahpd/state/deploy/ahpd/current` | symlink to the live release; switched by one atomic rename |
| `~/.ahpd/state/deploy/ahpd/deploy.log` | the deploy journal: which release went live, and when |
| `~/.ahpd/install.json` | the manifest this install wrote: what was created, so `uninstall` removes exactly that |
| `~/Library/LaunchAgents/dev.hallohuman.ahpd.plist` (Mac) | a launchd *agent* in `gui/$UID`, never a system daemon |
| `$XDG_CONFIG_HOME/systemd/user/ahpd.service` (Linux) | a systemd *user* unit, enabled with `systemctl --user` |

The boot item is the only thing outside `~/.ahpd`, and it is recorded by exact path so removal is exact.

## What it downloads, and why a checksum is not optional

Four separate supply chains, each pinned by exact version and checked before use:

| Download | Why |
| --- | --- |
| runtime | so the customer's own Node version is never involved |
| `ahpd` | the daemon |
| host plug-in | our host extensions (units, seats, accounts) |
| supervisor | what the boot item starts |

A pin carries `version`, `source` and `checksum`, and three checks refuse by name before any plan exists (@cto
2026-11-25):

- `checksum` is `sha256:<64 hex>` of the artifact's bytes, or npm's own `sha512-<86 base64>==` integrity for a
  published package; each is checked against its exact shape, so a truncated or prefixed one is refused, not trusted. a checksum not yet published is refused as
  `runtime has no published checksum yet; the install will not fetch it unchecked`.
- `source` is an `https://` URL — `http:` and `file:` are refused, because a checksum only protects what it came from.
- `version` is exact (`1.3.13`, `0.15.0-rc.4`); a range, a git tag or `latest` is refused.

## What it prints first

`install --plan` prints the whole contract and touches nothing: every path with one line saying why, the boot item
and the exact command that enables it, every download with version, source and checksum, and how many entries
`uninstall` will remove. `install` writes what the plan printed; `uninstall` walks the same list backwards, runs the
boot item's disable command first, and lists every path it removed.

One manifest answers all three questions — what the plan says, what install writes, what uninstall removes — so
removal cannot drift from creation. A test holds the plan, the entries and the removal list to the same list.

The switch is the deploy driver's own `activateRelease(layout, version, reason)`: one atomic rename of `current`
plus the journal line that says it happened, so the install and `ahpd deploy` move `current` through the same call and
the journal never misses a switch (@cto 2026-11-25). Code: `customerInstallManifest`, `renderInstallPlan`,
`removalList`, `installDeployLayout` and `activateRelease` in `packages/deploy` (`@ahpd/deploy`; the package is
renamed `@hallohuman/hightea-deploy` in the B batch, and this code is written against the current name).

## Prior art (the repo rule, before the change)

1. **The standards.** Neither AHP nor ACP has an install, provisioning or host-bootstrap action: ACP is agent-client,
   and AHP's methods cover sessions, records and (as extended) units. Installing a host is host operations, outside
   both, so no wire field is added here.
2. **Prior art in clients.** VS Code's server install is the closest everyday case: a user-owned folder
   (`~/.vscode-server`), a pinned server download, no root, and a checksum on the artifact it fetches — read through
   [REFERENCE.md](../REFERENCE.md)'s server procedure. Zed's install path takes an installation lease so two installers
   cannot race (named in @dev/3's note on #38276, `agent_servers/src/acp.rs:754-760`). `rustup` is the nearest match for
   the switch: release folders plus a `current` symlink, and a "switch back" that is one link change. Homebrew is the
   prior art for a published checksum per bottle.
3. **New abstractions named.** `InstallPin` (version + source + checksum as one value, because a version without its
   checksum is what lets an unchecked download through); `install.json` (the creation/removal contract, because
   `@ahpd/deploy` keeps a journal of deploys but nothing that says what an install created); the boot item record
   (because a launchd agent or systemd user unit is the one thing outside the folder, and uninstall must name it
   exactly). `@ahpd/deploy` has no prebuilt-artifact path — it fetches a git build — and no boot item, so these do not
   exist elsewhere in the repo.

## The one command, and where it lives

The installer's entry point is a POSIX shell bootstrap in the **Hightea repo**, next to the host guide, published as an
asset (@cto 2026-11-25). It must run before any runtime exists, so it lives nowhere else: not in this repo's
`scripts/`, and not in a new repository.

- The script pins the runtime's version and its `sha256` itself, verifies the download before running anything, and
  refuses on a mismatch.
- The host guide shows both forms: the download-then-inspect one, and the one-liner.
- Everything after the runtime exists is this package's `plan`/`apply`, so there is one manifest and one switch.

## Applying, and undoing it

`apply` walks the manifest in order and refuses rather than half-installs:

- A root that already exists with no `install.json` is refused by name and nothing is changed — a developer's
  `~/.ahpd` is never adopted, and an explicit `$AHPD_HOME` gets no exemption.
- The record goes down first as `{"state": "installing"}` and is closed as `"installed"` at the end, so an interrupted
  install resumes instead of refusing its own folder.
- Each download is fetched to a staging name, hashed, and compared to its pin **before** it is placed; a mismatch
  stops the install with the expected and actual digests and removes the staged bytes. A null checksum at apply time is
  a refusal, never a default.
- Verified bytes are made executable (`0755`) before they are moved into place: a download arrives `0644` and could
  not run.
- `current` moves through the deploy driver's `activateRelease`, so the switch is journaled; only then is the boot
  item written and loaded, and a failing enable command is reported with its own words.
- Every effect that throws becomes a refusal naming the step and the path — no crash, and no staged file left behind.

`uninstall` runs the boot item's disable command first, then removes the recorded files last-created-first and lists
them. A directory is removed only when it is empty; one the daemon has filled (sessions, records, logs) is **kept** and
named — `kept <path>: N entries not written by this install; remove by hand or run uninstall --purge` — so customer
data never goes without `--purge`, which prints exactly what it deletes first.

### Switching version

Running the same one command with a newer version is a switch, not a second install: the new release folder is placed
and verified the same way, `current` moves through `activateRelease`, the boot item is stopped and started again so it
picks up the new release, and only a started release is pruned for.

A start that fails does not leave a dead host pointing at a release nobody started: `current` goes back through
`activateRelease` with the reason "switching back after a failed start", the old release is started again, the record
goes back to the release that is running, and the refusal reports both halves of the attempt plus the switch back.
Nothing is pruned on that path.

A record that will not parse is refused — `install record at <path> is unreadable: <why>; nothing changed` — never read
as a fresh install, because it is the only statement of what that folder owns. A folder in `releases/` whose name is not
a version is never pruned and is named (`kept <name>: not a version`); a failure to list the release folders at all is
reported, not a silent "nothing to prune".

Pruning keeps `current` plus the newest `keep - 1` releases (`DEFAULT_KEEP` is 3), and the result names every folder it
deleted. The rule is one function in `@ahpd/deploy` (`releasesToPrune`) shared with the git deploy driver; only the
ordering differs — commit time there, version order here, with `0.10.0` above `0.9.0` and a release above its
release candidate.

## The daemon is one archive, and running it means unpacking it

`pins.ahpd` is a single `ahpd-<version>-<platform>-<arch>.tar.gz` built with its whole resolved tree inside (server plus
`node_modules`, native modules built for that machine), the way node and VS Code server ship (@cto 2026-11-25). Nothing
resolves from npm at install time and no package manager runs on the customer's machine.

The archive is read twice. First every entry is listed and checked: one absolute path, one `..`, one device or fifo, one
entry outside the single top directory named after the archive, or one link that points outside the release refuses the
whole archive and names the entry that did it. Only then is it written, into `<release>.staging`, with modes preserved
so `bin` entries and native `.node` files keep their exec bits, and ownership never touched. One rename puts the
verified tree at `releases/<version>`; `current` moves after that, never onto a tree that was not checked.

A pin that names another platform or arch is refused before anything is downloaded, with
`pins built for <platform>-<arch>, this machine is <platform>-<arch>`.

The record says `installed` before the prune runs, because a release that is running and recorded is installed whether
or not the tidy-up worked. A prune that then fails comes back as `pruneFailed {path, output}` on an otherwise good
result, and the command prints it as a warning and exits 0 — a full disk is never reported as a failed install. One
folder that will not delete (`EBUSY`, `EACCES`) stops the prune and is named, and the folders already removed are
listed with it, so a partly pruned disk is never reported as an unpruned one.

## Still open

- **Which supervisor the boot item starts.** process-compose is @dev/6's driver and Wednesday's trial; the manifest
  carries the supervisor as a pin, so this doc does not pre-empt the trial.
- **The pins themselves.** The `sha256` values are filled in as data, one line each, when each artifact is published;
  until then the refusal above is what a customer sees.

Homebrew and Nix stay optional, later, and out of this issue.
