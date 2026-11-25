/**
 * A customer host install: what lands where, said before anything is created.
 *
 * Operator 2026-11-24: asking a customer to install Nix is "a big ask", "even bigger than Docker"; Nix stays on our
 * machines and in the cloud (@cto 36d97490). So a customer host gets one folder the user owns, one boot item in the
 * user's own session, and downloads pinned to a version and checked against a published checksum.
 *
 * This module answers the only question an installer must answer before it touches the disk - what will you create? -
 * as data. `--plan` prints it, `install` writes it, `uninstall` removes it, and all three read the same manifest, so
 * removal cannot drift from creation.
 *
 * It does not place a version or switch to it: that is this package's own release-folder layout, `switchCurrent` and
 * `pruneReleases` (#38276). A customer install feeds them prebuilt artifacts instead of a git build, and adds no
 * second copy of the switch.
 */

/** Where the host runs. The boot item and its enable command are the only platform-dependent parts. */
export type InstallPlatform = 'darwin' | 'linux'

/** One pinned download. The version and the checksum travel together or the install stops by name. */
export interface InstallPin {
  /** `1.3.13`, `0.15.0-rc.4`, `v1.34.1`: an exact version, never a range, a tag or `latest`. */
  readonly version: string
  /** An https URL or an npm specifier; the plan prints it so a customer can read what is fetched. */
  readonly source: string
  /**
   * `sha512-<base64>` for an npm package (its `dist.integrity`), `sha256:<hex>` for a release binary.
   * `null` means the publisher has not published it yet: the plan says so and the install refuses by name, because a
   * download used without its checksum is the silent error this row exists to prevent.
   */
  readonly checksum: string | null
}

/** The four downloads a customer install makes. Each one is a separate supply chain and gets its own pin. */
export interface InstallPins {
  /** The runtime the daemon runs on, so the customer's own Node is never involved. */
  readonly runtime: InstallPin
  readonly ahpd: InstallPin
  /** Our host plug-in (the hh extensions: units, seats, accounts). */
  readonly hostPlugin: InstallPin
  /** The supervisor the boot item starts. */
  readonly supervisor: InstallPin
}

export interface InstallEntry {
  readonly kind: 'dir' | 'file' | 'symlink' | 'boot-item'
  /** Absolute path. Every entry but the boot item is inside the install root. */
  readonly path: string
  /** A symlink's target, or `download:<name>` for a file whose bytes a pin brings. */
  readonly from?: string
  /** One line, in the plan and in the manifest the uninstaller reads. */
  readonly why: string
}

export interface InstallBootItem {
  readonly kind: 'launchd-agent' | 'systemd-user-unit'
  /** The file the loader reads. Outside the install root, and recorded so uninstall removes exactly this one. */
  readonly path: string
  /** The command that turns it on, printed by the plan and run by the install. */
  readonly enable: string
  /** The command that turns it off first, run by uninstall before the file goes. */
  readonly disable: string
}

export interface InstallManifest {
  readonly platform: InstallPlatform
  /** The folder the user owns; everything else is derived from it. */
  readonly root: string
  readonly version: string
  readonly pins: InstallPins
  readonly bootItem: InstallBootItem
  /** Creation order. Uninstall walks it backwards. */
  readonly entries: readonly InstallEntry[]
}

export interface InstallOptions {
  readonly platform: InstallPlatform
  /** The user's home directory, passed in rather than read, so a plan is a pure function of its inputs. */
  readonly home: string
  /** An explicit install root (`$AHPD_HOME`); the bootstrap resolves the variable and passes it. */
  readonly root?: string
  /** The ahpd version this install places; also the release folder's name. */
  readonly version: string
  readonly pins: InstallPins
  /** `$XDG_CONFIG_HOME`; defaults to `<home>/.config`, as the XDG base-directory spec says. */
  readonly configHome?: string
}

export type InstallRefusal =
  | { readonly kind: 'missing-checksum'; readonly download: keyof InstallPins }
  | { readonly kind: 'unpinned-version'; readonly download: keyof InstallPins; readonly version: string }

export const INSTALL_ROOT_NAME = '.ahpd';
export const BOOT_LABEL = 'dev.hallohuman.ahpd';
/** The service name the install's release folders are filed under; the same name `ahpd deploy` uses. */
export const INSTALL_SERVICE = 'ahpd';

const isPinned = (version: string): boolean => /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version);

/** Every refusal this manifest would have to answer for, named by the download it is about. */
export const installRefusals = (pins: InstallPins): readonly InstallRefusal[] => {
  const refusals: InstallRefusal[] = []
  for (const download of Object.keys(pins) as (keyof InstallPins)[]) {
    const pin = pins[download]
    if (!isPinned(pin.version)) refusals.push({ kind: 'unpinned-version', download, version: pin.version })
    if (pin.checksum === null) refusals.push({ kind: 'missing-checksum', download })
  }
  return refusals
}

const bootItemFor = (platform: InstallPlatform, home: string, configHome: string): InstallBootItem =>
  platform === 'darwin'
    ? {
        kind: 'launchd-agent',
        path: `${home}/Library/LaunchAgents/${BOOT_LABEL}.plist`,
        enable: `launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/${BOOT_LABEL}.plist"`,
        disable: `launchctl bootout gui/$(id -u)/${BOOT_LABEL}`,
      }
    : {
        kind: 'systemd-user-unit',
        path: `${configHome}/systemd/user/ahpd.service`,
        enable: 'systemctl --user enable --now ahpd.service',
        disable: 'systemctl --user disable --now ahpd.service',
      }

/**
 * The manifest, or the refusals that stop an install from being planned at all. No filesystem call: the same inputs
 * give the same answer on any machine, which is what lets the plan be tested against the install.
 */
export const customerInstallManifest = (
  options: InstallOptions,
):
  | { readonly ok: true; readonly manifest: InstallManifest }
  | { readonly ok: false; readonly refusals: readonly InstallRefusal[] } => {
  const refusals = installRefusals(options.pins)
  if (refusals.length) return { ok: false, refusals }

  const root = options.root ?? `${options.home}/${INSTALL_ROOT_NAME}`
  const configHome = options.configHome ?? `${options.home}/.config`
  const bootItem = bootItemFor(options.platform, options.home, configHome)

  const stateDir = `${root}/state`
  const entries: InstallEntry[] = [
    { kind: 'dir', path: root, why: 'the one folder this install owns' },
    { kind: 'dir', path: stateDir, why: "the daemon's state: sessions, records, the deploy journal" },
    { kind: 'dir', path: `${stateDir}/deploy/${INSTALL_SERVICE}`, why: "@ahpd/deploy's own layout: release folders, current, the journal" },
    { kind: 'dir', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases`, why: 'every release folder, so switching back keeps the old one' },
    { kind: 'dir', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases/${options.version}`, why: `ahpd ${options.version} and the runtime it runs on` },
    { kind: 'file', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases/${options.version}/runtime`, from: 'download:runtime', why: 'the pinned runtime: the customer Node is not used' },
    { kind: 'file', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases/${options.version}/ahpd`, from: 'download:ahpd', why: 'the daemon' },
    { kind: 'file', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases/${options.version}/host-plugin`, from: 'download:host-plugin', why: 'our host plug-in' },
    { kind: 'file', path: `${stateDir}/deploy/${INSTALL_SERVICE}/releases/${options.version}/supervisor`, from: 'download:supervisor', why: 'the supervisor the boot item starts' },
    { kind: 'symlink', path: `${stateDir}/deploy/${INSTALL_SERVICE}/current`, from: `releases/${options.version}`, why: 'switched by one atomic rename; versions and switch-back read it' },
    { kind: 'file', path: `${root}/install.json`, why: 'this manifest, so uninstall removes exactly what was created' },
    { kind: 'boot-item', path: bootItem.path, from: 'boot-item', why: `starts ahpd in the user session on ${options.platform}` },
  ]

  return {
    ok: true,
    manifest: { platform: options.platform, root, version: options.version, pins: options.pins, bootItem, entries },
  }
}

/** The layout `switchCurrent`, `pruneReleases` and `currentRelease` take, so the install calls them and copies nothing. */
export const installDeployLayout = (manifest: InstallManifest): { readonly stateDir: string; readonly service: string } => ({
  stateDir: `${manifest.root}/state`,
  service: INSTALL_SERVICE,
})

/** The removal list: the creation list, backwards, and nothing else. */
export const removalList = (manifest: InstallManifest): readonly InstallEntry[] => [...manifest.entries].reverse();

/**
 * The plan a customer reads before anything is created: every path, every boot item, every download with its pinned
 * version and checksum. One line per fact, no summary that could differ from the list.
 */
export const renderInstallPlan = (manifest: InstallManifest): readonly string[] => {
  const lines = [`ahpd ${manifest.version} on ${manifest.platform}, under ${manifest.root}:`]
  for (const entry of manifest.entries) {
    lines.push(`  create ${entry.kind} ${entry.path}${entry.from && entry.from !== 'boot-item' ? ` (${entry.from})` : ''} - ${entry.why}`)
  }
  for (const download of Object.keys(manifest.pins) as (keyof InstallPins)[]) {
    const pin = manifest.pins[download]
    lines.push(`  fetch ${download} ${pin.version} from ${pin.source} - verify ${pin.checksum ?? 'MISSING CHECKSUM'}`)
  }
  lines.push(`  enable ${manifest.bootItem.kind} ${manifest.bootItem.path} - ${manifest.bootItem.enable}`)
  lines.push(`uninstall removes ${String(removalList(manifest).length)} entries, this boot item included, and lists them.`)
  return lines
}

/** The refusal sentence a person reads, naming the download that has no checksum or no exact version. */
export const describeRefusal = (refusal: InstallRefusal): string =>
  refusal.kind === 'missing-checksum'
    ? `refused: ${refusal.download} has no published checksum yet; the install will not fetch it unchecked`
    : `refused: ${refusal.download} version ${refusal.version} is not an exact version`
