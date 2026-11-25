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
  type: 'mcpServer',
  id: mcpServerIdOf(uri, name),
  name,
  uri,
  ...extra,
  state,
});
