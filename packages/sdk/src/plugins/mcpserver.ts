import type { Bag } from '../types/common.js';

/**
 * The id an MCP server's customization is published under.
 *
 * The URI of what declares it, with the server's name in a fragment, so two
 * servers of one file are two customizations. A `#` the URI already carries
 * is escaped first, so a name that looks like a fragment cannot collide with
 * one that was there. Derived from the name alone, so the same server keeps
 * its id across reloads of a session and a targeted token stays aimed.
 */
export const mcpServerIdOf = (uri: string, name: string): string =>
  `${uri.replaceAll('#', '%23')}#mcp=${encodeURIComponent(name)}`;

/**
 * One MCP server as a session's customization: `type`, `id`, `name`, `uri`,
 * whatever `extra` the backend says of it (such as `enablement`), then its
 * `state`, one of the protocol's `McpServerState`s.
 */
export const mcpServerCustomization = (uri: string, name: string, state: Bag, extra: Bag = {}): Bag => ({
  // First, so an extra field can add to the customization and never replace what names it.
  ...extra,
  type: 'mcpServer',
  id: mcpServerIdOf(uri, name),
  name,
  uri,
  state,
});

/**
 * Whether a metadata URL an upstream named may be fetched: https, or http on
 * this machine's own loopback. The URL comes from the server being signed in
 * to, so nothing else is asked on its say-so.
 */
const fetchable = (at: string): boolean => {
  try {
    const url = new URL(at);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  }
  catch {
    return false;
  }
};

/**
 * What an MCP server says about signing into it, per RFC 9728.
 *
 * `metadataUrl` is the `resource_metadata` a server's own `WWW-Authenticate`
 * named, asked first where it may be fetched (`fetchable`) and never through
 * a redirect. Then as VS Code finds it: the well-known path with the server's
 * path appended where the URL has one, then the origin's own, each answer
 * taken only where its `resource` is the one it was asked for (the server's
 * URL for the first, its origin for the second), since RFC 9728 says the two
 * MUST match. Answers the discovered document, or a bare one naming the server
 * itself: the URL is the canonical resource identifier, so an incomplete
 * answer is still a true one, and what a client loses is the one-click
 * sign-in, not the knowledge that it needs to sign in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/oauth.ts#L1201-L1290
 * https://datatracker.ietf.org/doc/html/rfc9728#PRConfigurationValidation
 */
export async function protectedResource(url: string, name: string, ms = 15_000, metadataUrl?: string): Promise<Bag> {
  const bare: Bag = { resource: url, resource_name: name };
  const target = new URL(url);
  const root = `${target.origin}/.well-known/oauth-protected-resource`;
  const fetched = async (at: string, expected: readonly string[], redirect: 'follow' | 'manual' = 'follow'): Promise<Bag | undefined> => {
    const said = await fetch(at, { headers: { Accept: 'application/json' }, redirect, signal: AbortSignal.timeout(ms) })
      .then((answer) => (answer.status === 200 ? answer.json() as Promise<unknown> : undefined))
      .catch(() => undefined);
    if (typeof said !== 'object' || said === null) return undefined;
    const metadata = said as Bag;
    if (typeof metadata.resource !== 'string') return undefined;
    try {
      const named = new URL(metadata.resource).toString();
      return expected.some((one) => new URL(one).toString() === named) ? metadata : undefined;
    }
    catch {
      return undefined;
    }
  };
  return (metadataUrl !== undefined && fetchable(metadataUrl) ? await fetched(metadataUrl, [url, target.origin], 'manual') : undefined)
    ?? (target.pathname !== '/' ? await fetched(`${root}${target.pathname}`, [url]) : undefined)
    ?? await fetched(root, [target.origin])
    ?? bare;
}
