// The names and the pin-base of one customer-host release (#38280), apart from the build so a test can hold them.
// The contract is hightea `packages/server/src/host-release-route.ts`; it is repeated here rather than imported because
// this repository must cut a release without a hightea checkout, and a name that drifts is a 404 for every customer.

export const TAG = /^hh-[0-9]+-[0-9a-f]{8}$/u;
/** An exact version; a pre-release part (`-rc.4`, `-dev.abc`) is inside it, as the route allows. */
export const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
export const TARGET = String.raw`(?:linux|darwin)-(?:x64|arm64)`;
export const CONTRACT = [
  new RegExp(`^ahpd-${VERSION}-${TARGET}\\.tar\\.gz$`, 'u'),
  new RegExp(`^pins-${TARGET}\\.json$`, 'u'),
  new RegExp(`^bun-${TARGET}$`, 'u'),
  new RegExp(`^ahpd-deploy-${VERSION}\\.tgz$`, 'u'),
  new RegExp(`^host-plugin-${VERSION}\\.js$`, 'u'),
  new RegExp(`^supervisor-${VERSION}-${TARGET}$`, 'u'),
];
export const inContract = (name) => CONTRACT.some((pattern) => pattern.test(name));

/** The version every ahpd asset carries; the formula scripts/pack-host-archive.mjs uses for the release folder. */
export const ahpdVersion = (serverVersion, commit) => `${serverVersion}-beorn.${commit.slice(0, 8)}`;

/** The six names of one release, for one target. */
export const assetNames = ({ version, runtimeVersion, supervisorVersion, pluginVersion, target }) => ({
  archive: `ahpd-${version}-${target}.tar.gz`,
  pins: `pins-${target}.json`,
  runtime: `bun-${target}`,
  deploy: `ahpd-deploy-${version}.tgz`,
  plugin: `host-plugin-${pluginVersion}.js`,
  supervisor: `supervisor-${supervisorVersion}-${target}`,
});

/**
 * The three pins scripts/pack-host-archive.mjs consumes, in the shape it validates: exact version, https source,
 * sha256 of the bytes, and platform/arch on the two that are machine-specific. The ahpd pin is the pack script's.
 */
export const pinBase = ({ version, platform, arch, tag, sourceBase, names, versions, checksums }) => {
  const pin = (name, pinVersion, extra = {}) => ({
    version: pinVersion,
    ...extra,
    source: `${sourceBase.replace(/\/+$/u, '')}/${tag}/${name}`,
    checksum: `sha256:${checksums[name]}`,
  });
  return {
    version,
    platform,
    pins: {
      runtime: pin(names.runtime, versions.runtime, { platform, arch }),
      hostPlugin: pin(names.plugin, versions.hostPlugin),
      supervisor: pin(names.supervisor, versions.supervisor, { platform, arch }),
    },
  };
};

/**
 * What a second machine's run uploads to a release the first one drafted: the two shared assets only when the draft
 * lacks them, then this machine's own four. A name already there is refused (a release asset is never replaced), and a
 * shared asset whose bytes differ is refused with both digests, because both machines must publish the same one.
 */
export const appendPlan = ({ onRelease, shared, mine, localChecksums, remoteChecksums }) => {
  for (const name of mine) if (onRelease.has(name)) return { ok: false, refusal: `${name} is already on the release; a release asset is never replaced` };
  const upload = [];
  for (const name of shared) {
    if (!onRelease.has(name)) {
      upload.push(name);
      continue;
    }
    if (remoteChecksums[name] !== localChecksums[name])
      return { ok: false, refusal: `${name} on the release is ${String(remoteChecksums[name])}, this run built ${String(localChecksums[name])}; the shared asset must be identical on both machines` };
  }
  return { ok: true, upload: [...upload, ...mine] };
};

/** The machines a draft can be published for: each `pins-<target>.json` that is on it. */
export const finalizeTargets = (onRelease) =>
  ['linux-x64', 'darwin-arm64'].filter((target) => onRelease.has(`pins-${target}.json`));
