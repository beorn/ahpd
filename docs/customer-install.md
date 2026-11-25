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

A pin carries `version`, `source` (an https URL or an npm specifier) and `checksum` (`sha512-…` from npm's
`dist.integrity`, or `sha256:…` for a release binary). A download whose checksum is not published yet is **refused by
name** — `runtime has no published checksum yet; the install will not fetch it unchecked` — never fetched and never
installed by trust. A floating version (`latest`, a range, a git tag) is refused the same way, before a plan exists.

## What it prints first

`install --plan` prints the whole contract and touches nothing: every path with one line saying why, the boot item
and the exact command that enables it, every download with version, source and checksum, and how many entries
`uninstall` will remove. `install` writes what the plan printed; `uninstall` walks the same list backwards, runs the
boot item's disable command first, and lists every path it removed.

One manifest answers all three questions — what the plan says, what install writes, what uninstall removes — so
removal cannot drift from creation. A test holds the plan, the entries and the removal list to the same list.

Code: `customerInstallManifest`, `renderInstallPlan`, `removalList`, `installDeployLayout` and `switchCurrent` in
`packages/deploy` (`@ahpd/deploy`). The switch is the deploy driver's own one atomic rename, exported for this use.

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

## Open, and deliberately not decided here

- **Where the one command lives.** A ~40-line POSIX shell bootstrap (it must run before any runtime exists) that
  downloads the pinned runtime and then runs this package's plan/apply is the recommendation; whether that bootstrap
  is `scripts/install` in this repo or a small customer-facing repo is @cto's call, and it does not change the manifest.
- **Which supervisor the boot item starts.** process-compose is @dev/6's driver and Wednesday's trial; the manifest
  carries the supervisor as a pin, so this doc does not pre-empt the trial.
- **The pins themselves.** Bun's published sha256 and npm `dist.integrity` values are filled in as data, one line each,
  when the artifacts are published; until then the refusal above is what a customer sees.

Homebrew and Nix stay optional, later, and out of this issue.
