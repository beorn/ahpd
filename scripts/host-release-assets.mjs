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
