/**
 * The ahpd a box runs a session's host with, installed in the folder of the
 * user it is reached as, as VS Code installs its CLI on a host it reaches over
 * SSH: a box no download is made for refused in VS Code's words before
 * anything is installed, the install pinned to this host's build at a path
 * keyed by that build, reused when it is there, downloaded by the box when it
 * is not, checked with `--version`, the five most recently used kept, and on a
 * failed download the newest other install of this host's run in its place.
 * A box with no install that runs is sent the files by its host
 * (`hostcopy.ts`), and the same script installs from them.
 * Every folder the box answers is checked to be one of this host's installs
 * before it is run, as VS Code checks a fallback CLI's path.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L935-L938
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/remoteAgentHostCliInstaller.ts#L41-L175
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L149-L283
 *
 * What is installed is what a machine's `/opt/ahpd` holds of the `node` and
 * `ahpd` parts, at the versions `versions.json` names: Node from its download,
 * checked by its sha256, `@ahpd/server` by `npm ci` from the ahpd part's lock,
 * the part's plugins from theirs in a plugin root of the install's own, and a launcher
 * that runs it on that Node.
 * The folder is under `$XDG_DATA_HOME/ahpd/server`, where ahpd keeps its data,
 * so the install needs no `sudo` and leaves any other ahpd on the box as it is.
 * The plugin root is given to the host a session starts, and the launcher
 * leaves it unset, so `ahpd plugin install` run there puts a plugin in the
 * box's configuration folder, where it outlives the install, as VS Code starts
 * its CLI with a data folder beside its versioned installs.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L84-L99
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostService.ts#L943
 */

import { createHash } from 'node:crypto';
import { lockFilesOf, lockOf, PART_NPM_FLAGS, PART_PLUGIN_FLAGS, platformOf, readParts, versionsPath } from './parts.js';
import type { Part, Tarball } from './parts.js';

/** The folder the installs are in, as the box's own `sh` expands it. */
export const HOST_ROOT = '"${XDG_DATA_HOME:-$HOME/.local/share}/ahpd/server"';

/** An install's folder under the root, `<version>-<hash>`, and nothing else there. */
export const INSTALL_GLOB = `*-${'[0-9a-f]'.repeat(12)}`;

/**
 * The `uname -m` answers of a Linux box each Node download in `versions.json`
 * is for, as VS Code's installer reads a box's platform.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L149-L179
 */
export const HOST_MACHINES = { 'linux-x64': ['x86_64', 'amd64'], 'linux-arm64': ['aarch64', 'arm64'] } as const;

/** The folder under the root that a host's copy of the files is in while one install reads it, as the box's `sh` expands it. */
const COPY_FOLDER = '.copy-$key';

/** The line that ends each file the script writes, which no line of a JSON file is. */
const END = 'AHPD_PART_FILE';

/*
 * The script, sent to the box's `sh` on stdin after the `files` function that
 * writes the ahpd part's lock, with the install's folder and the two Node
 * downloads with their sums as its arguments. It prints
 * `root=<the root>`, `platform=<the platform>` and `install=<the folder that runs>`, with `installed=yes`
 * after an install and `fallback=yes` when the folder is another install than
 * the one asked for.
 *
 * `uname` answers the platform VS Code's installer reads, and a box that is not
 * Linux on x86_64 or aarch64 has no Node download in `versions.json`. The
 * download is unpacked in a folder of its own under the root and renamed into
 * place once `--version` answers, so a folder at the install's path is always
 * a whole install; a second install that finished first is kept, and the
 * later one removed. A copy the host sent is read in place of the download and
 * of npm's registry, checked by the same sum and the same lock, and removed
 * after; `node-pty` is then built with the headers in that Node, not downloaded ones. The launcher finds its folder from its own path, so an
 * install holds no path of the folder it was made in.
 */
const SCRIPT = `
key=$1 x64=$2 x64sum=$3 arm64=$4 arm64sum=$5
case "$(uname -s) $(uname -m)" in
  ${HOST_MACHINES['linux-x64'].map((one) => `'Linux ${one}'`).join('|')}) url=$x64 sum=$x64sum platform=linux-x64 ;;
  ${HOST_MACHINES['linux-arm64'].map((one) => `'Linux ${one}'`).join('|')}) url=$arm64 sum=$arm64sum platform=linux-arm64 ;;
  *) echo "Unsupported remote platform: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
case "$url" in
  *.tar.xz) how=-xJf ;;
  *.tar.gz) how=-xzf ;;
  *) how=-xjf ;;
esac
root=${HOST_ROOT}
dir="$root/$key"
copy="$root/${COPY_FOLDER}"
echo "root=$root"
echo "platform=$platform"
installs() { ls -1td -- "$root"/${INSTALL_GLOB} 2>/dev/null; }
prune() { installs | awk 'NR>5' | xargs -I{} rm -rf -- {} 2>/dev/null; true; }
if [ -x "$dir/bin/ahpd" ]; then
  touch -- "$dir"
  prune
  echo "install=$dir"
  exit 0
fi
install() {
  mkdir -p "$root" && tmp=$(mktemp -d "$root/.install-XXXXXX") || return 1
  (
    cd "$tmp" &&
    if [ -d "$copy" ]; then
      npm_config_cache="$copy/npm" npm_config_offline=true npm_config_nodedir="$tmp/node" && export npm_config_cache npm_config_offline npm_config_nodedir &&
      cp -- "$copy/node.tar" node.tar
    else
      curl --fail --silent --show-error --location --connect-timeout 30 --output node.tar "$url"
    fi &&
    printf '%s  node.tar\\n' "$sum" | sha256sum --check --strict - &&
    mkdir node && tar "$how" node.tar -C node --strip-components=1 && rm node.tar &&
    PATH="$tmp/node/bin:$PATH" && export PATH &&
    mkdir ahpd && files ahpd &&
    npm ci --prefix "$tmp/ahpd" ${PART_NPM_FLAGS} &&
    { [ ! -d ahpd/plugins ] || npm ci --prefix "$tmp/ahpd/plugins" ${PART_PLUGIN_FLAGS}; } &&
    mkdir bin &&
    printf '%s\\n' '#!/bin/sh' 'here=$(cd -- "$(dirname -- "$0")/.." && pwd)' 'exec "$here/node/bin/node" "$here/ahpd/node_modules/.bin/ahpd" "$@"' > bin/ahpd &&
    chmod +x bin/ahpd &&
    bin/ahpd --version
  ) && { [ -e "$dir" ] || mv -- "$tmp" "$dir"; }
  held=$?
  rm -rf -- "$tmp" "$copy"
  return $held
}
if install >&2; then
  echo "install=$dir"
  echo installed=yes
  prune
  exit 0
fi
found=$(installs | while IFS= read -r one; do
  if "$one/bin/ahpd" --version >/dev/null 2>&1; then echo "$one"; break; fi
done)
[ -n "$found" ] || exit 1
echo "install=$found"
echo fallback=yes
`;

/**
 * Whether a folder the box answered is one of this host's installs: directly
 * under the root it answered and named `<version>-<12 hex digits>`, as VS Code
 * holds a fallback CLI's path to the shape of its own installs before running
 * it, since the folder is what the command that starts the host is made from.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sshRemoteAgentHostHelpers.ts#L255-L283
 */
export const isHostInstall = (dir: string, root: string): boolean => {
  if (root === '' || !dir.startsWith(`${root}/`)) return false;
  const name = dir.slice(root.length + 1);
  const at = name.lastIndexOf('-');
  return at > 0 && !name.includes('/') && /^[0-9a-f]{12}$/.test(name.slice(at + 1));
};

/**
 * What the box runs with the host's copy on its stdin: the files unpacked in a
 * folder of their own and renamed into the place the script reads, so a copy
 * that did not arrive whole is never there.
 */
export const copyCommand = (install: Pick<HostInstall, 'key'>): string[] => ['sh', '-c', `
root=${HOST_ROOT}
copy="$root/.copy-$1"
mkdir -p "$root" && tmp=$(mktemp -d "$root/.copying-XXXXXX") || exit 1
tar -xf - -C "$tmp" && rm -rf -- "$copy" && mv -- "$tmp" "$copy" && exit 0
rm -rf -- "$tmp"
exit 1
`, 'sh', install.key];

/** The command the box runs, before the install's arguments, with the install's script on its stdin. */
export const HOST_INSTALL_COMMAND = ['sh', '-s', '--'] as const;

/** One install of ahpd on a box. */
export interface HostInstall {
  /** The version of ahpd it is. */
  version: string;
  /**
   * Its folder under the root: the version, then a hash of the script and
   * every pinned value it is given, so a moved version, lock or download is
   * a new folder.
   */
  key: string;
  /** What `HOST_INSTALL_COMMAND` is given after it. */
  args: string[];
  /** The script, the ahpd part's lock written into it. */
  script: string;
  /** The Node download of each platform, by the platform the script prints. */
  node: Record<string, { url: string; sha256: string }>;
  /** The ahpd part's lock, which the script writes. */
  lock: readonly Tarball[];
}

/**
 * The install the parts file pins, read from `versions.json` when no parts are
 * given, with the ahpd part's lock, read beside that file when none is given.
 */
export const hostInstallOf = (parts: readonly Part[] = readParts(), lock?: readonly Tarball[]): HostInstall => {
  const node = parts.find((one) => one.kind === 'node');
  const ahpd = parts.find((one) => one.kind === 'ahpd');
  if (node === undefined || ahpd === undefined) {
    throw new Error(`${versionsPath()} names no ${node === undefined ? 'node' : 'ahpd'} part, so there is no ahpd to install on a box`);
  }
  const x64 = platformOf(node, 'linux-x64');
  const arm64 = platformOf(node, 'linux-arm64');
  const pinned = [x64.url, x64.sha256, arm64.url, arm64.sha256];
  const held = lock ?? lockOf(ahpd) ?? [];
  // Each file as a here-document, its last newline the one the document ends with.
  const files = held.flatMap((one) => {
    const text = one.bytes.toString('utf8');
    return [`  cat > "$1/${one.name}" <<'${END}'`, text.endsWith('\n') ? text.slice(0, -1) : text, END];
  });
  const folder = lockFilesOf(held, true).length === 0 ? [] : ['  mkdir "$1/plugins"'];
  const script = ['files() {', ...folder, ...files, '}', SCRIPT].join('\n');
  const key = `${ahpd.version}-${createHash('sha256').update([script, ...pinned].join('\0')).digest('hex').slice(0, 12)}`;
  return { version: ahpd.version, key, args: [key, ...pinned], script, node: { 'linux-x64': x64, 'linux-arm64': arm64 }, lock: held };
};
