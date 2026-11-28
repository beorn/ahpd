import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentCapabilities, McpServer as AcpMcpServer } from '@agentclientprotocol/sdk';
import { machineAsked, machinePathOf, mcpServerCustomization, protectedResource, secretRef } from '@ahpd/sdk';
import type { ProxyEndpoint, Spawn, Start, ToolsEndpoint, UpstreamRefusal } from '@ahpd/sdk';
import { heardCapabilities, isNoRollout, watchSession } from '../catalog.js';
import { childProcessOf, connectAcp, KILL_GRACE_MS } from '../connection.js';
import { HOST_TOOLS } from '../mapping.js';
import type { AcpConnection, AcpOptions } from '../types.js';
import { messageOf } from './common.js';
import { admitCustody } from './custody.js';
import type { Custody, CustodyIdentity } from './custody.js';
import type { HostToolsAnswer, SessionContext } from './context.js';
import type { Bag, LogLevel } from '@ahpd/sdk';

/** Spawning the server, signing in and opening the one session on it. */
export interface Opening {
  open(): Promise<{ connection: AcpConnection; sessionId: string }>;
  authenticationFailure(why: unknown): { errorType: string; message: string } | undefined;
  /**
   * Read the record again, and put a new server behind the conversation when
   * what it spawns with changed.
   *
   * Called as the session is created and at the start of every turn. Answers
   * a sentence when the record can no longer be used, which is the turn's own
   * refusal, and nothing otherwise.
   */
  refreshOptions(): string | undefined;
  /**
   * The host's own tools endpoint, once the session's open has opened it.
   *
   * Asked rather than kept, because it is opened inside the first `session/new`
   * and a session whose server has not opened has none. What asks is the offering
   * being replaced: a client that arrives or goes moves the list the agent was
   * handed, and the endpoint is the only thing serving it.
   */
  toolsEndpoint(): ToolsEndpoint | undefined;
}

/**
 * The options a spawned server is built from, which an edit is compared on.
 *
 * A model is not here: ACP carries the model choice as a session config the
 * server owns, and the value reaches a turn through the agent's defaults rather
 * than through the spawn. A provider, a name and a description are the record's
 * own row, which a running session does not get to change.
 */
const SPAWN_KEYS = [
  'command', 'args', 'env', 'cwd', 'authenticate', 'authenticateInMachine',
  'hostTools', 'honoursTrust', 'toolsChanged', 'machine',
] as const;

/** Every field a record may change, which a fresh read puts on the options a session holds. */
const LIVE_KEYS = [
  'command', 'args', 'env', 'cwd', 'provider', 'displayName', 'description', 'model',
  'authenticate', 'authenticateInMachine', 'hostTools', 'honoursTrust', 'toolsChanged', 'machine', 'variant',
  'cutTurns', 'stderrTail', 'portFailures', 'modesFrom', 'unreportedClientCalls', 'findFreshMs',
  'listingIdleMs', 'sessionListMaxPages', 'exitGraceMs', 'stderrBytes', 'startAnswerMs', 'toolCallSilenceMs',
  'lastResortMs', 'toolRequestBoundMs', 'toolRequestBounds', 'killGraceMs', 'closeGraceMs',
] as const;

/** What a spawned server is built from, as one string to compare an edit by. */
const spawnOf = (one: AcpOptions): string =>
  JSON.stringify(SPAWN_KEYS.map((key) => [key, (one as unknown as Record<string, unknown>)[key]]));

/** The `_meta` a server answered opening a conversation with, when it gave one as an object (#37272). */
const openedMetaOf = (answer: { _meta?: unknown } | null | undefined): Record<string, unknown> | undefined => {
  const meta = answer?._meta;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? (meta as Record<string, unknown>) : undefined;
};

/**
 * Whether the handshake advertised something ACP writes as an empty object.
 *
 * `session/close`, `sessionCapabilities.additionalDirectories` and every entry
 * of `promptCapabilities` are advertised this way, so what is read is whether
 * the key is there at all rather than what it says - the same way
 * `catalog.ts` reads the server's own catalogue.
 */
const advertised = <T>(capability: T | null | undefined): boolean =>
  capability !== undefined && capability !== null;

/**
 * The hosts that name this machine itself, wherever the address is read.
 *
 * A loopback address is the reader's own, and a wildcard bind is the address a
 * daemon listens on rather than one anything connects to: inside a container
 * either one is the container.
 */
const SELF_ONLY = new Set(['localhost', '0.0.0.0', '[::]', '[::1]']);

/**
 * Whether a session running at `where` can reach the host's tools at `url`.
 *
 * `where` is the machine the session runs in, as its `computer://<id>`, or
 * nothing for this host, which reaches the daemon at whatever address it
 * serves. In a machine the answer is `false` for a loopback or wildcard
 * address and `true` for any other, which is a guess about the network rather
 * than an answer from the machine; this is the one place it is made, so a
 * reachable address the machine's port reports can replace it.
 */
export const toolsReachable = (url: string, where: string | undefined): boolean => {
  if (where === undefined) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  }
  catch {
    return false;
  }
  return !SELF_ONLY.has(host) && !/^127\./u.test(host);
};

/** Where a URL's server is, as `host:port`, with nothing of its path or credentials. */
const addressOf = (url: string): string => {
  try {
    return new URL(url).host;
  }
  catch {
    return 'an address that is not a URL';
  }
};

/**
 * Publish the configured MCP servers as this session's customizations and say
 * so to every client watching. A server's id comes from its name alone, so it
 * stays the same across reloads and a targeted token stays aimed. `stateOf`
 * is handed the server's state as it stood, `starting` for one not yet said.
 */
export const publishServers = (ctx: SessionContext, names: readonly string[], stateOf: (name: string, was: Bag) => Bag): void => {
  const before = new Map(ctx.servers.map((one) => [String(one.name), (one.state ?? { kind: 'starting' }) as Bag]));
  ctx.servers = names.map((name) => mcpServerCustomization(
    `acp-internal:/mcp/${encodeURIComponent(name)}`,
    name,
    stateOf(name, before.get(name) ?? { kind: 'starting' }),
  ));
  ctx.emit('session', { type: 'session/customizationsChanged', customizations: ctx.published() });
};

/** Every configured server this session publishes, by name, in order. */
export const serverNames = (ctx: SessionContext): string[] => ctx.servers.map((one) => String(one.name));

/**
 * Say one server needs signing in to, as the spec's `authRequired` state.
 *
 * The resource is the server's RFC 9728 metadata, found once, from the URL
 * its own challenge named when it named one. The scopes are the ones the
 * challenge asked for, else the ones the metadata says it supports.
 */
export const signInNeeded = async (
  ctx: SessionContext,
  name: string,
  url: string,
  reason: 'required' | 'expired' | 'insufficientScope',
  said: Partial<UpstreamRefusal> = {},
): Promise<void> => {
  const resource = ctx.resources.get(name)
    ?? await protectedResource(url, name, 15_000, said.metadataUrl).catch((): Bag => ({ resource: url, resource_name: name }));
  ctx.resources.set(name, resource);
  const scopes = said.scope !== undefined
    ? said.scope.split(' ').filter((one) => one !== '')
    : Array.isArray(resource.scopes_supported) ? resource.scopes_supported.filter((one: unknown): one is string => typeof one === 'string') : [];
  const next = {
    kind: 'authRequired',
    reason,
    resource,
    ...(scopes.length > 0 ? { requiredScopes: scopes } : {}),
  };
  /*
   * Said once per requirement, not once per request (#38864, @cto 2026-11-28): a server that keeps refusing the
   * same token says the same thing, and a client told it again has nothing new to act on. A changed requirement -
   * another reason, another resource, other scopes - is published, and so is one coming back after `ready`.
   */
  const was = ctx.servers.find((one) => String(one.name) === name)?.state as Bag | undefined;
  if (was !== undefined && was.kind === next.kind && was.reason === next.reason
    && JSON.stringify(was.resource) === JSON.stringify(next.resource)
    && JSON.stringify(was.requiredScopes ?? []) === JSON.stringify(next.requiredScopes ?? [])) return;
  publishServers(ctx, serverNames(ctx), (one, previous) => one !== name ? previous : next);
};

/**
 * The pass-through one configured HTTP server is reached by, opened the first
 * time and kept: a server that died is reopened with the same URL and token.
 * A 401 or 403 the upstream answers is the one signal ACP will ever give about
 * a server, so it is said as `authRequired`: `insufficientScope` for a 403
 * that named a scope, `required` otherwise.
 */
const proxyOf = (ctx: SessionContext, name: string, server: { url: string; headers?: Record<string, string> }): ProxyEndpoint | undefined => {
  const held = ctx.proxies.get(name);
  if (held !== undefined) return held;
  const opened = ctx.start.proxyServer?.({
    url: server.url,
    ...(server.headers === undefined ? {} : { headers: server.headers }),
    tokenNow: () => ctx.serverTokens.get(name),
    refused: (said) => {
      // The token that was refused is not sent again.
      ctx.serverTokens.delete(name);
      void signInNeeded(ctx, name, server.url, said.status === 403 && said.scope !== undefined ? 'insufficientScope' : 'required', said);
    },
  });
  if (opened !== undefined) ctx.proxies.set(name, opened);
  return opened;
};

/**
 * One value ACP must carry as a string, with a `$secret` reference read out of
 * the host's vault first (#39059).
 *
 * A record's `mcpServers` entry may name its credential as `{ "$secret": "host:x" }`,
 * the way its `env` may, and the host is the only thing that can read it. ACP
 * has no shape for a reference: a server's headers and variables are strings,
 * so one passed through would reach the agent as an object - refused by an http
 * server that tests its authorization header for a bearer, and a type error
 * everywhere else. So it is read here, at the moment the session opens, through
 * the same reader `env` uses.
 *
 * A reference nothing can read fails the session loudly and by name: an agent
 * started with a server it was denied, or with an empty credential, is worse
 * than one that was not started. The refusals name the server and the secret,
 * never the value, because a refusal is printed on a terminal and written to a
 * log.
 */
const carriedValue = async (
  server: string,
  field: string,
  value: unknown,
  read: ((name: string) => Promise<string>) | undefined,
): Promise<string> => {
  const referenced = secretRef(value);
  if (referenced === undefined) {
    if (typeof value !== 'string') {
      throw new Error(`MCP_SERVER_VALUE_NOT_A_STRING: ${server} ${field} is not a string, so this agent cannot be given it`);
    }
    return value;
  }
  if (read === undefined) {
    throw new Error(`MCP_SERVER_SECRET_UNREADABLE: ${server} ${field} names ${referenced}, and this agent has no vault to read it from`);
  }
  let held: string;
  try {
    held = await read(referenced);
  }
  catch (error) {
    throw new Error(`MCP_SERVER_SECRET_UNREADABLE: ${server} ${field} names ${referenced}: ${messageOf(error)}`);
  }
  if (typeof held !== 'string' || held === '') {
    throw new Error(`MCP_SERVER_SECRET_UNREADABLE: ${server} ${field} names ${referenced}, which the vault does not hold as a value`);
  }
  return held;
};

/**
 * One server's headers, each reference read, in the order the entry wrote them.
 */
const carriedHeaders = async (
  name: string,
  headers: Record<string, unknown> | undefined,
  read: ((name: string) => Promise<string>) | undefined,
): Promise<Record<string, string> | undefined> => {
  if (headers === undefined) return undefined;
  const out: Record<string, string> = {};
  for (const [header, value] of Object.entries(headers)) {
    out[header] = await carriedValue(name, `header ${header}`, value, read);
  }
  return out;
};

/**
 * The host's servers this record is offered, by the names it declares (#39079).
 *
 * A record that declares nothing is handed the whole map, which is what every
 * record written before the field did. A record that declares names is handed
 * exactly those; a name the host does not offer fails here, loudly and by name,
 * rather than opening a session short a server its record said it had.
 */
export const offeredServers = <T>(all: Record<string, T> | undefined, declared: readonly string[] | undefined, who: string): Record<string, T> => {
  const offered = all ?? {};
  if (declared === undefined) return offered;
  const missing = declared.filter((name) => !(name in offered));
  if (missing.length > 0) throw new Error(`MCP_SERVER_UNKNOWN: ${who} names ${missing.join(', ')}, which the host does not offer`);
  return Object.fromEntries(Object.entries(offered).filter(([name]) => declared.includes(name)));
};

/**
 * The MCP servers a session is opened with, in ACP's shape.
 *
 * The host's own map, less whatever the handshake says this server cannot take,
 * plus the host's tools as one HTTP server when `hostTools` is on and the
 * session can reach them from the machine it runs in. A server left out is said
 * rather than dropped, because a deployment that configured a server and
 * watches a session not reach it has no other way to find out.
 */
const serversFor = async (
  start: Start,
  declaredServers: readonly string[] | undefined,
  who: string,
  own: () => ToolsEndpoint | undefined,
  capabilities: AgentCapabilities | undefined,
  hostTools: boolean,
  machine: string | undefined,
  say: (line: string) => void,
  leftOut: (name: string, why: string) => void = () => {},
  proxied: (name: string, server: { url: string; headers?: Record<string, string> }) => ProxyEndpoint | undefined = () => undefined,
  toolsAnswer: (answer: HostToolsAnswer) => void = () => {},
  unreached: (name: string) => void = () => {},
  read: ((name: string) => Promise<string>) | undefined = undefined,
): Promise<AcpMcpServer[]> => {
  const taken: AcpMcpServer[] = [];
  const mcp = capabilities?.mcpCapabilities;
  /**
   * The URL a session's machine reaches a daemon endpoint at, or nothing where
   * it cannot: a machine's runtime names the host its own way, and a loopback
   * address is out of reach from a container.
   */
  const reachedFrom = async (url: string): Promise<string | undefined> => {
    const reached = machine === undefined ? undefined : await start.computers?.reach?.(machine, url);
    const at = reached ?? url;
    return reached === undefined && !toolsReachable(at, machine === undefined ? undefined : `computer://${machine}`) ? undefined : at;
  };
  for (const [name, one] of Object.entries(offeredServers(start.mcpServers, declaredServers, who))) {
    // #39059: a `$secret` in a header is read here, before either path takes the
    // entry, so the pass-through and the agent both see the value ACP can carry.
    const headers = one.type === 'http' ? await carriedHeaders(name, one.headers, read) : undefined
    // ACP has one shape per transport and this host has two, so a stdio server
    // is a name, a command and a list of variables, and an HTTP one is a name,
    // a URL and a list of headers.
    if (one.type === 'http') {
      if (mcp?.http !== true) {
        say(`${name}: this ACP server takes no MCP server over HTTP, so it was left out`);
        leftOut(name, 'This ACP server takes no MCP server over HTTP.');
        continue;
      }
      /*
       * Through the host's pass-through where there is one: ACP hands a server
       * its headers once, when the session opens, so a token a client renews
       * would never reach it. The agent gets the endpoint's URL and its own
       * token; the upstream's token, and the configured headers, stay with the
       * host. A machine that cannot reach the daemon gets the server direct,
       * and is told a renewal will not reach it.
       */
      const through = proxied(name, headers === undefined ? { url: one.url } : { url: one.url, headers });
      const at = through === undefined ? undefined : await reachedFrom(through.url);
      if (through !== undefined && at === undefined) {
        say(`${name}: computer://${String(machine)} cannot reach the daemon at ${addressOf(through.url)}, so it gets this server direct and a renewed token will not reach it`);
        // The pass-through is taken back: a token handed to a server that got
        // the upstream's own URL would go to a path nothing is sent to, and the
        // server would be said ready on a credential it never received.
        unreached(name);
      }
      taken.push(at === undefined || through === undefined
        ? { type: 'http', name, url: one.url, headers: Object.entries(headers ?? {}).map(([header, value]) => ({ name: header, value })) }
        : { type: 'http', name, url: at, headers: [{ name: 'authorization', value: `Bearer ${through.token}` }] });
      continue;
    }
    // ACP cannot say where a stdio server starts, so a directory goes with it
    // and is not sent. Said rather than dropped, like every server left out.
    if (one.cwd !== undefined) {
      say(`${name}: ACP carries no directory for a stdio MCP server, so ${one.cwd} was left out`);
    }
    taken.push({
      name,
      command: one.command,
      args: one.args ?? [],
      env: await Promise.all(Object.entries(one.env ?? {}).map(async ([variable, value]) => ({
        name: variable,
        value: await carriedValue(name, `env.${variable}`, value, read),
      }))),
    });
  }
  /*
   * A session that declared tools and is handed none of them is said as well
   * as answered. The answer reaches the client that opened the session, and
   * nobody reading this host's log: a turn that ran with no tools then looks
   * like an agent that thought better of it. So the host log names the reason,
   * once per session that actually lost something - a session that declared
   * nothing has lost nothing.
   */
  const declared = start.tools?.length ?? 0;
  const sayLeftOut = (why: string): void => {
    say(`${HOST_TOOLS}: ${why}, so this session's ${String(declared)} declared tool${declared === 1 ? ' was' : 's were'} left out`);
  };
  // A host that offers its sessions no tools has nothing to answer about them.
  if (start.toolsServer === undefined) {
    if (declared > 0) sayLeftOut('this host serves no tools endpoint');
    return taken;
  }
  if (!hostTools) {
    if (declared > 0) sayLeftOut('this agent runs with hostTools off');
    toolsAnswer({ available: false, reason: 'Host tools are turned off for this agent.' });
    return taken;
  }
  // The host's own tools are one HTTP server among the rest, so a server that
  // takes none over HTTP is not told about this one either.
  if (mcp?.http !== true) {
    say(`${HOST_TOOLS}: this ACP server takes no MCP server over HTTP, so it was left out`);
    toolsAnswer({ available: false, reason: 'This ACP server takes no MCP server over HTTP.' });
    return taken;
  }
  const endpoint = own();
  if (endpoint === undefined) {
    toolsAnswer({ available: false, reason: 'The host opened no tools endpoint for this session.' });
    return taken;
  }
  /*
   * The URL the machine uses for the daemon, where its port answers one.
   *
   * A daemon on a loopback address is out of reach from a container, and the
   * machine's runtime is the one that knows the name it publishes the host
   * under. An answer replaces the endpoint's own address; no answer keeps the
   * reading below.
   */
  const url = await reachedFrom(endpoint.url);
  if (url === undefined) {
    say(`host tools: computer://${String(machine)} cannot reach the daemon at ${addressOf(endpoint.url)}, so they were left out`);
    toolsAnswer({ available: false, reason: `computer://${String(machine)} cannot reach the host's tools.` });
    return taken;
  }
  // ACP spells an HTTP server as a URL and a list of headers, so the token goes
  // over as the one header it is.
  taken.push({
    type: 'http',
    name: HOST_TOOLS,
    url,
    headers: [{ name: 'authorization', value: `Bearer ${endpoint.token}` }],
  });
  toolsAnswer({ available: true });
  return taken;
};

/**
 * What a machine port answers, with a refusal said as `portFailures` says.
 *
 * `spawn`, the default, says `The <what> could not start in computer://<id>.`
 * and logs the port's own message, which can name a socket path, a registry or
 * an image. `message` passes the port's refusal on as it is.
 */
export const askMachine = async <T>(
  options: Pick<AcpOptions, 'portFailures' | 'log' | 'provider'>,
  id: string,
  what: 'agent' | 'terminal',
  ask: () => Promise<T>,
): Promise<T> => {
  try {
    return await ask();
  }
  catch (error) {
    if (options.portFailures === 'message') throw error;
    options.log?.(`${options.provider}: computer://${id}: the ${what} could not start: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw new Error(`The ${what} could not start in computer://${id}.`);
  }
};

/**
 * The machine this session was told to run in, as its id, or nothing.
 *
 * A name that cannot be reached throws rather than falling back to this host: a
 * session that asked for a sandbox and silently ran outside one is worse than
 * one that did not start. The reading is shared by the server's own spawn and
 * by every terminal the server asks for, so both name the same machine - and a
 * host with no computers port is refused for both, since neither can reach it.
 */
export const machineIdOf = (start: Start): string | undefined => {
  // Trimmed and emptiness-checked in one place, because the computer plugin's
  // schema says an empty value runs on the host and that arrives as often as
  // an absent one does.
  const said = machineAsked(start);
  if (said === undefined) return undefined;
  const named = /^computer:\/\/([^/\s]+)$/.exec(said);
  if (named === null) throw new Error(`${said} is not a computer URI; a session runs in computer://<id>`);
  const id = named[1] as string;
  if (start.computers === undefined) {
    throw new Error(`This session asked to run in ${id}, and this host has no computer plugin to run it in`);
  }
  return id;
};

/**
 * The JSON-RPC code the protocol's `auth_required` carries, read off the SDK
 * rather than written out, because a code this file recognises by hand is a
 * code it stops recognising if the protocol moves it.
 */
const AUTH_REQUIRED = RequestError.authRequired().code;

/** How long past the kill grace an opening waits for a predecessor's custody before refusing (#34599). */
const ADMIT_MARGIN_MS = 2000;

export function createOpening(ctx: SessionContext, capabilityOwner: AcpOptions): Opening {
  const { options, provider, start, cwd, replay } = ctx;

  /**
   * The host's own tools, as the one HTTP server this session hands its agent.
   *
   * Asked for once and kept: the endpoint answers with a token of its own, and
   * a server that dies is opened again with the same endpoint, so asking per
   * open would leave the process behind the first one answering for a session
   * nothing is listening to.
   *
   * The runner goes with it, because some of the tools in that list are a
   * client's: the server has nothing to run one of those with, and the session
   * is the only thing that knows which client owns which tool and how to ask
   * it.
   *
   * `toolsChanged` goes with it too, and defaults to `notify` here rather than
   * to the tool server's own `list`: the list this session serves holds a
   * client's tools, and a client arriving mid-turn is the ordinary case rather
   * than a rare one. A deployment that would rather its agents re-listed than
   * be interrupted sets `list`.
   */
  let endpoint: ToolsEndpoint | undefined;
  let asked = false;
  const toolsServer = (): ToolsEndpoint | undefined => {
    if (!asked) {
      endpoint = start.toolsServer?.({
        runClient: ctx.ranByClient,
        toolsChanged: options.toolsChanged ?? 'notify',
      });
      asked = true;
    }
    return endpoint;
  };

  /** Whether the server said it can be given directories beside the one it runs in. */
  let extras = false;
  /**
   * The ids of the `authMethods` the server's `initialize` answer offered.
   *
   * A server names them once, at the start of a connection, and an error that
   * arrives later has to name them itself: the sentence that says which way
   * to sign in is the whole of what a person is given.
   */
  let authMethods: string[] = [];

  /**
   * The machine this session was told to run in, as something to spawn.
   *
   * A session whose settings name a computer runs the server there, through
   * the port the host carries. A name that cannot be
   * reached throws rather than falling back to this host: a session that asked
   * for a sandbox and silently ran outside one is worse than one that did not
   * start.
   */
  const placed = async (): Promise<Spawn | undefined> => {
    const id = machineIdOf(start);
    if (id === undefined) return undefined;
    // Said again so the type knows what `machineIdOf` has already guaranteed:
    // a session with no computers port was refused there and never reaches this.
    const computers = start.computers;
    if (computers === undefined) {
      throw new Error(`This session asked to run in ${id}, and this host has no computer plugin to run it in`);
    }
    /*
     * No `cwd` here: the session's `cwd` is this host's directory, and the only
     * paths that mean anything inside the machine are its own. The port uses
     * the machine's working directory when the caller names none.
     */
    const spawn = await askMachine(options, id, 'agent', () => computers.how(id, {
      command: options.command,
      ...(options.args === undefined ? {} : { args: options.args }),
      ...(options.env === undefined ? {} : { env: options.env }),
    }));
    if (spawn === undefined) throw new Error(`There is no computer called ${id}`);
    return spawn;
  };

  /**
   * The sign-in the spec named, sent once between the handshake and the
   * session.
   *
   * Nothing is sent when the spec names no method, and a method the server did
   * not offer fails the start naming the ones it did: a bridge that guessed
   * would sign a person in as whoever the guess was, and the guess is not
   * something a configuration can be corrected about afterwards.
   *
   * A sign-in the server refuses is the server's own refusal, said as it made
   * it, rather than a request for a sign-in nobody has made.
   *
   * `placed` says the server runs in a machine, where the preset's machine
   * variables are set too and `authenticateInMachine` is the one sent.
   */
  const authenticate = async (connection: AcpConnection, placed: boolean): Promise<void> => {
    const asked = placed ? options.authenticateInMachine ?? options.authenticate : options.authenticate;
    if (asked === undefined) return;
    if (!authMethods.includes(asked.methodId)) {
      const offered = authMethods.join(', ');
      throw new Error(`${provider} offers ${offered === '' ? 'no sign-in method' : offered}, not ${asked.methodId}`);
    }
    await connection.authenticate({
      methodId: asked.methodId,
      ...(asked._meta === undefined ? {} : { _meta: asked._meta }),
    }).catch((why: unknown) => {
      // A server that answers the sign-in and refuses it has said why, and that
      // is the turn's failure. The protocol's `auth_required` would send the
      // person back to the option they have already set.
      throw new Error(`${provider}: sign-in with ${asked.methodId} failed: ${messageOf(why)}`);
    });
  };

  /**
   * The protocol's `auth_required`, as the error a turn ends with.
   *
   * A server answers `session/new` and `session/prompt` with it when it wants
   * to be signed in, and the generic failure would carry the sentence
   * "Authentication required" with nothing to do about it. The methods come
   * from the `initialize` answer, which is the only place they are ever named.
   */
  const authenticationFailure = (why: unknown): { errorType: string; message: string } | undefined => {
    if (!(why instanceof RequestError) || why.code !== AUTH_REQUIRED) return undefined;
    const offered = authMethods.length === 0 ? 'offers no sign-in method' : `offers ${authMethods.join(', ')}`;
    return {
      errorType: 'authRequired',
      message: `${provider}: this ACP server wants to be signed in before it answers, and ${offered}; set the authenticate option to the one to use`,
    };
  };

  /**
   * Spawn the server, hand it a client, and open the one session on it.
   *
   * One promise for the whole of it, so a second turn that arrives while the
   * first is still shaking hands waits on the same server rather than spawning
   * another. A failure clears it and stops the server it spawned, so the next
   * turn tries again.
   *
   * A fork is asked first and is the one case that copies rather than
   * continues: the conversation it was given stays where it is and this session
   * gets one of its own, from a server that advertised `session.fork`.
   *
   * A resume and a reopen after a death both continue a conversation rather
   * than start one, and which call continues it is the server's own answer.
   * `session/resume` takes it back with nothing replayed, and is chosen when
   * the server advertised it and the host already holds the conversation -
   * a resume that replays a conversation the host has is a conversation every
   * client draws twice. Otherwise `session/load`, whose replay is the only
   * record of a conversation this process never watched, and which the reopen
   * after a death goes through when there is nothing better. A server that
   * advertised neither cannot be continued at all, and says so rather than
   * silently starting a new conversation with nothing on screen about it.
   */
  const open = (): Promise<{ connection: AcpConnection; sessionId: string }> => {
    if (ctx.opening !== undefined) return ctx.opening;
    ctx.loading = true;
    ctx.failedOpen = undefined;
    /*
     * The config every client holds as the open begins, read before the open
     * learns the server's own: `learnModes`, `learnConfigOptions` and
     * `learnModels` write the server's values over the session's, and the
     * session's own are what the open sends.
     */
    const values = { ...ctx.values };
    const startingWith = spawnOf(options);
    /** The server this open spawned, once it has, with what it ran. */
    let made: AcpConnection | undefined;
    let ran: { command: string; path: string | undefined } | undefined;
    /** This opening's custody of the seat's ACP child (#34599), held from admission until its child's end is recorded. */
    let custody: Custody | undefined;
    // Install the pending identity before the opening body can reach placement.
    const pending: Promise<{ connection: AcpConnection; sessionId: string }> = Promise.resolve().then(async () => {
      /*
       * A folder the host did not vouch for, and an agent that loads the
       * folder's own hooks and settings unchecked.
       *
       * ACP carries no trust field and this host reads none of a project's
       * files for an ACP agent, so what a folder holds reaches the agent
       * whatever this bridge does with it. Not starting the agent there is the
       * one thing left, unless the preset says its agent asks before it loads
       * the folder's own configuration - and an absent `Start.trusted` is the
       * host having said nothing, which is the same answer as untrusted.
       */
      if (options.honoursTrust !== true && start.trusted?.(cwd) !== true) {
        throw new Error(`${provider}: ${cwd} is not a folder this host trusts, and an ACP agent loads a project's own settings and hooks from the folder it runs in; trust the folder, or set honoursTrust on this preset if its agent asks before it loads them`);
      }
      const moved = await placed();
      if (ctx.disposed || ctx.opening !== pending || spawnOf(options) !== startingWith) {
        throw new Error(`${provider}: this opening was superseded before the ACP server could start`);
      }
      /*
       * The folder as the agent reaches it: the host's own for an agent on this
       * host, and its machine path for one in a machine - the same text on
       * Linux and macOS, drive-style on Windows. The catalogue's record below
       * keeps the host's, since that is the folder a client named.
       */
      const told = moved === undefined ? cwd : machinePathOf(cwd);
      const prefix = options.env?.HAB_ACP_PID_PREFIX;
      if (options.spawnGuard !== undefined && options.env?.HAB_ACP_SPAWN_GUARD !== undefined) {
        throw new Error(`${provider}: a record cannot configure HAB_ACP_SPAWN_GUARD; the host projects each occurrence before spawn`);
      }
      if (options.spawnGuard !== undefined && (prefix === undefined || moved !== undefined || process.platform !== 'linux')) {
        throw new Error(`${provider}: inherited spawn custody requires a scoped local Linux opening; nothing was spawned`);
      }
      if (prefix !== undefined && (prefix === '' || options.env?.HAB_ACP_SESSION_URI !== start.uri
        || (options.env?.HAB_ACP_CHAT_URI !== undefined
          ? options.env.HAB_ACP_CHAT_URI !== start.chatUri : start.sessionConversation !== true))) {
        throw new Error(`${provider}: this conversation has no matching configured ACP process authority`);
      }
      if (prefix !== undefined) {
        // Admission waits, on a timer, for a predecessor still inside its kill grace to record its end (#34599).
        const held = await admitCustody(prefix, (options.killGraceMs ?? KILL_GRACE_MS) + ADMIT_MARGIN_MS, provider, options.spawnGuard === 'inherited-fd-v1', options.log);
        if (ctx.disposed || ctx.opening !== pending || spawnOf(options) !== startingWith) {
          held.release();
          throw new Error(`${provider}: this opening was superseded before the ACP server could start`);
        }
        // The turn open now is the one this child is spawned to serve: its start was logged before this write (#38456).
        const spawningTurn = ctx.active === undefined ? undefined : String(ctx.active.id);
        if (!held.write('spawning', null, spawningTurn)) {
          held.release();
          throw new Error(`${provider}: could not record ACP custody at ${prefix}.custody; nothing was spawned`);
        }
        custody = held;
      }
      // A machine's PATH is the machine's, which this host does not know.
      ran = {
        command: moved?.command ?? options.command,
        path: moved === undefined ? start.env?.PATH ?? options.env?.PATH ?? process.env.PATH : undefined,
      };
      let connection: AcpConnection;
      let escaped: import('node:child_process').ChildProcess | undefined;
      let setupFailed = false;
      let escapedIdentity: CustodyIdentity | null = null;
      try {
        connection = connectAcp({
        spawned: (child) => {
          escaped = child;
          child.on('error', (error) => {
            if (!setupFailed) return; // The ordinary transport owns errors after setup succeeds.
            const line = `${provider}: retained transport child reported ${messageOf(error)}`;
            options.log?.(line, 'error');
          });
          child.once('close', () => { if (setupFailed) custody?.end(escapedIdentity); });
        },
        ...(custody?.inheritedFd === undefined ? {} : { extraStdio: [custody.inheritedFd] }),
        command: moved?.command ?? options.command,
        ...(moved !== undefined
          ? { args: moved.args }
          : options.args === undefined ? {} : { args: options.args }),
        /*
         * On this host the agent's own variables go over the preset's, so the
         * commands it runs reach the shell authentication helper. In a machine
         * only the machine's are used: the helper's socket is this host's.
         * The spawn guard the host projects goes last, so nothing a record or
         * the helper names can stand in for it (#34599).
         */
        ...(moved !== undefined
          ? (moved.env === undefined ? {} : { env: moved.env })
          : (options.env === undefined && start.env === undefined
            ? {}
            : { env: {
              ...(options.env ?? {}),
              ...(start.env ?? {}),
              ...(custody?.spawnGuard === undefined ? {} : { HAB_ACP_SPAWN_GUARD: JSON.stringify({
                ...custody.spawnGuard, fd: 3, opening: custody.opening,
              }) }),
            } })),
        ...(moved?.cwd !== undefined ? { cwd: moved.cwd } : moved === undefined ? { cwd } : {}),
        handlers: {
          update: ctx.sessionUpdate,
          permission: ctx.requestPermission,
          // A question needs nothing but a chat to put it on, so both of these
          // are always here rather than behind a capability the host might not
          // have sent.
          elicitation: ctx.askElicitation,
          elicitationComplete: ctx.heardElicitationComplete,
          // Where a server's account goes, for a host that keeps one per agent.
          ...(start.onAccount === undefined ? {} : { account: start.onAccount }),
          // Each half only where the session has what it needs: an
          // unadvertised capability is a request a conformant server never
          // makes, and one with nothing behind it would throw.
          ...(start.resources === undefined
            ? {}
            : {
                readTextFile: ctx.readTextFile,
                ...(start.resources.write === undefined ? {} : { writeTextFile: ctx.writeTextFile }),
              }),
          ...(start.terminals === undefined
            ? {}
            : {
                createTerminal: ctx.createTerminal,
                terminalOutput: ctx.terminalOutput,
                waitForTerminalExit: ctx.waitForTerminalExit,
                killTerminal: ctx.killTerminal,
                releaseTerminal: ctx.releaseTerminal,
              }),
        },
        ...(options.log === undefined ? {} : { log: options.log }),
        ...(options.exitGraceMs === undefined ? {} : { exitGraceMs: options.exitGraceMs }),
        ...(options.startAnswerMs === undefined ? {} : { startAnswerMs: options.startAnswerMs }),
        ...(options.toolCallSilenceMs === undefined ? {} : { toolCallSilenceMs: options.toolCallSilenceMs }),
        ...(options.lastResortMs === undefined ? {} : { lastResortMs: options.lastResortMs }),
        ...(options.stderrBytes === undefined ? {} : { stderrBytes: options.stderrBytes }),
        ...(options.killGraceMs === undefined ? {} : { killGraceMs: options.killGraceMs }),
        });
        custody?.releaseInherited();
      }
      catch (error) {
        setupFailed = true;
        if (escaped === undefined) custody?.end(null);
        else if (custody !== undefined && escaped.pid !== undefined) {
          // A setup exception is not a no-child receipt. Retain this actual
          // process and its inherited guard until its OS close is observed.
          try {
            escapedIdentity = custody.identify(escaped.pid);
            custody.write('running', escapedIdentity);
          } catch (identityError) {
            const line = `${provider}: failed transport child remains unstamped: ${messageOf(identityError)}`;
            options.log?.(line, 'error');
          }
          custody.releaseInherited();
        }
        throw error;
      }
      ctx.live = connection;
      made = connection;
      const assertCurrent = (): void => {
        if (ctx.opening !== pending || ctx.live !== connection || ctx.disposed) throw new Error(`${provider}: opening was superseded`);
      };
      // A server that dies between turns is let go, so the next turn spawns
      // another rather than prompting a process that is no longer there.
      // The child as stamped once it has a live identity; until then, an end records no child.
      let child: CustodyIdentity | null = null;
      void connection.ended.then(() => {
        custody?.end(child);
        if (ctx.successfulOpening?.connection === connection) ctx.successfulOpening = undefined;
        if (ctx.live !== connection) return;
        ctx.live = undefined;
        ctx.opening = undefined;
        // A turn the server started itself has no prompt to fail with it, so
        // it ends here, or no client would ever see it end.
        if (ctx.agentTurnId !== undefined) ctx.agentTurn({ turnId: ctx.agentTurnId, phase: 'end', reason: 'abandoned' });
      });
      if (custody !== undefined) {
        // A failed stamp keeps `spawning` and the lock until the child's end is recorded: nothing manufactures `ended`.
        const pid = childProcessOf(connection)?.pid;
        if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) throw new Error(`${provider}: the ACP child has no live process identity`);
        child = custody.identify(pid);
        if (!custody.write('running', child)) throw new Error(`${provider}: could not record the running ACP child in its custody record`);
      }
      const initializeResponse = await connection.initialize();
      assertCurrent();
      const { agentCapabilities } = initializeResponse;
      ctx.closes = advertised(agentCapabilities?.sessionCapabilities?.close);
      ctx.loads = agentCapabilities?.loadSession === true;
      ctx.resumes = advertised(agentCapabilities?.sessionCapabilities?.resume);
      ctx.forks = advertised(agentCapabilities?.sessionCapabilities?.fork);
      // And for the agent, which offers a fork only where its server can make one.
      // Launch options belong to this Start; advertised agent capabilities
      // remain in the catalog's one existing owner shared by its sessions.
      heardCapabilities(capabilityOwner, agentCapabilities);
      ctx.promptCapabilities = agentCapabilities?.promptCapabilities ?? undefined;
      extras = advertised(agentCapabilities?.sessionCapabilities?.additionalDirectories);
      authMethods = (initializeResponse.authMethods ?? []).map((one) => one.id);
      await authenticate(connection, moved !== undefined);
      /*
       * The directories beside the one the server runs in, only to a server that
       * advertised them.
       *
       * ACP calls this an optional capability, and a server that never said it
       * takes them cannot be handed a field it does not know: the directories
       * are remembered on this session either way, so nothing is lost by not
       * sending them.
       */
      const extra = extras && start.additional !== undefined && start.additional.length > 0
        ? { additionalDirectories: start.additional }
        : {};
      /*
       * The servers this session is opened with: the host's own, less what the
       * handshake says this server cannot take, plus the host's tools as one
       * HTTP server unless the deployment turned that off or the machine the
       * session runs in cannot reach them.
       */
      const left = new Map<string, string>();
      /** The record, as an operator knows it, for a server it named and the host does not have. */
      const who = options.displayName ?? options.provider ?? 'this record';
      const servers = await serversFor(
        start,
        options.mcpServers,
        who,
        toolsServer,
        agentCapabilities,
        options.hostTools !== false,
        moved === undefined ? undefined : machineIdOf(start),
        (line: string, level?: LogLevel) => options.log?.(line, level),
        (name, why) => left.set(name, why),
        (name, server) => proxyOf(ctx, name, server),
        (answer) => { ctx.hostTools = answer; },
        (name) => {
          const held = ctx.proxies.get(name);
          if (held === undefined) return;
          ctx.proxies.delete(name);
          held.close();
        },
        options.secret,
      );
      /*
       * The configured servers as customizations, so a targeted token can name
       * one (the host looks a target up among them). `starting` until the
       * server answers the open, `error` for one this server could not take.
       * The host's own tools are not among them: their token is the host's.
       */
      publishServers(ctx, Object.keys(offeredServers(start.mcpServers, options.mcpServers, who)), (name) => left.has(name)
        ? { kind: 'error', error: { errorType: 'mcpServerFailed', message: left.get(name) } }
        : { kind: 'starting' });
      /*
       * The conversation to continue: the one this session already had when
       * its server died, or else the one a resume named. Both go through the
       * same call, because they are the same thing - a conversation this
       * bridge has to hand back to a server rather than start again.
       *
       * The session's own id comes first, because after a fork it is the copy
       * and not the conversation `start.resume` names.
       */
      const died = ctx.acpSessionId !== undefined;
      const reopen = ctx.acpSessionId ?? start.resume;
      /*
       * A fork copies the conversation into a new one of its own.
       *
       * Asked first, because it is the one case where the session the server
       * is left with is not the one it was handed: the old conversation stays
       * where it is and this session gets a copy. What the host named is the
       * turn to copy through, and this server can only be asked for the whole
       * of what it holds - so a fork at any turn but the last one behind the
       * conversation is refused rather than served as a copy of something
       * else. The control is not offered for such a turn either, which is why
       * this is a caller out of step rather than a person's mistake.
       *
       * Only the first open forks. A reopen after a death continues the copy
       * the fork made, and never forks again.
       */
      if (start.forkAt !== undefined && !died) {
        if (start.resume === undefined) {
          throw new Error(`${provider}: a fork names the conversation it copies, and this one named no session`);
        }
        if (!ctx.forks) {
          throw new Error(`${provider}: this ACP server cannot fork a session, so "${start.resume}" cannot be copied`);
        }
        const last = ctx.turns.at(-1);
        if (String(last?.id ?? '') !== start.forkAt) {
          throw new Error(`${provider}: "${start.forkAt}" is not the last turn of "${start.resume}", and a fork copies the whole conversation rather than part of it`);
        }
        const copied = await connection.forkSession({
          sessionId: start.resume,
          cwd: told,
          mcpServers: servers,
          ...extra,
        });
        assertCurrent();
        ctx.acpSessionId = copied.sessionId;
        ctx.openedMeta = openedMetaOf(copied);
        ctx.learnModes(copied.modes);
        ctx.learnConfigOptions(copied.configOptions);
        ctx.learnModels(copied);
        await ctx.sendAsked({ connection, sessionId: copied.sessionId }, values);
      }
      else if (reopen !== undefined) {
        /*
         * A resume is taken back rather than replayed only where the host holds
         * the conversation already.
         *
         * `Start.seed` is the turns the host has, and a server that replays the
         * same ones is a conversation every client draws twice - which is the
         * whole of what `session/resume` exists for. With no seed there is
         * nothing on this side of the wire and the replay is the only record,
         * so the load is what is wanted even where the server offers both.
         *
         * A reopen after a death is the other case: the record is this
         * process's own, so nothing is replayed for it either.
         */
        const held = start.seed ?? [];
        const taking = ctx.resumes && (died || held.length > 0);
        if (!taking && !ctx.loads) {
          throw new Error(died
            ? `${provider}: the server died and this one cannot load a session, so "${reopen}" cannot be continued`
            : `${provider}: this ACP server cannot load a session, so "${reopen}" cannot be resumed`);
        }
        const request = {
          sessionId: reopen,
          cwd: told,
          mcpServers: servers,
          ...extra,
        };
        let sessionId = reopen;
        const taken = await (taking ? connection.resumeSession(request) : connection.loadSession(request)).catch(async (why: unknown) => {
          if (!ctx.neverSpoken || held.length > 0 || ctx.turns.length > 0 || replay.length > 0 || !isNoRollout(why, reopen)) throw why;
          const created = await connection.newSession({ cwd: told, mcpServers: servers, ...extra });
          sessionId = created.sessionId;
          return created;
        });
        assertCurrent();
        ctx.acpSessionId = sessionId;
        ctx.openedMeta = openedMetaOf(taken);
        ctx.learnModes(taken.modes);
        ctx.learnConfigOptions(taken.configOptions);
        ctx.learnModels(taken);
        await ctx.sendAsked({ connection, sessionId }, values);
      }
      else {
        const created = await connection.newSession({
          cwd: told,
          mcpServers: servers,
          ...extra,
        });
        assertCurrent();
        ctx.acpSessionId = created.sessionId;
        ctx.openedMeta = openedMetaOf(created);
        ctx.learnModes(created.modes);
        ctx.learnConfigOptions(created.configOptions);
        ctx.learnModels(created);
        await ctx.sendAsked({ connection, sessionId: created.sessionId }, values);
      }
      /*
       * The server has now said what it serves, so the host can read
       * `Session.models` and put the list on the agent, as agent-claude and
       * agent-pi do. Without this a client is never offered a model.
       */
      assertCurrent();
      /*
       * Opened with every server it was handed, which is the last thing ACP
       * says about them: `ready` now is the truthful moment, and nothing
       * later moves it.
       */
      publishServers(ctx, ctx.servers.map((one) => String(one.name)), (name, was) => was.kind === 'starting' ? { kind: 'ready' } : was);
      ctx.start.onHandshake?.();
      /*
       * The catalogue's record starts here, where the server has named the
       * session and what it said is known. The turn already running is attached
       * because `sendMessage` starts it before the server does, and a
       * transcript that dropped the first turn would be a conversation missing
       * its question.
       *
       * The host's own turns go with it for the same reason: a resume and a
       * fork both replay nothing, so without them the record would hold a
       * conversation that starts at whatever the person says next. The replay
       * the host was still keeping content of goes in once it is kept.
       */
      await ctx.keeping;
      assertCurrent();
      ctx.record = watchSession({
        provider,
        id: ctx.acpSessionId,
        cwd,
        additional: start.additional ?? [],
        title: ctx.title,
        replay,
        seed: start.seed ?? [],
      });
      /*
       * The record has it now, and this list must not keep it: a server that
       * dies and is reopened replays the whole conversation again, and a list
       * that still held the first replay would push it a second time.
       */
      replay.length = 0;
      if (ctx.watchedTurn !== undefined && !ctx.record.turns.includes(ctx.watchedTurn)) ctx.record.turns.push(ctx.watchedTurn);
      return { connection, sessionId: ctx.acpSessionId };
    });
    ctx.opening = pending;
    /*
     * The replay ends where the open does, whether it worked or not: what the
     * server said on the way belongs to no turn after this point. What the
     * open learned is said then, where it differs from the config every client
     * held as it began: the mode, the options and the model the server runs
     * with, once the values the session holds have been sent.
     */
    const opened = (succeeded: boolean): void => {
      if (ctx.opening !== pending) return;
      ctx.loading = false;
      ctx.syncConfig(values);
      if (succeeded && made !== undefined && ctx.live === made && ctx.opening === pending && !ctx.disposed) {
        ctx.successfulOpening = { connection: made, opening: pending };
      }
    };
    void pending.then(() => opened(true), () => opened(false));
    /*
     * An open that fails lets go of itself and of the server it spawned, so a
     * server that refused the session or its sign-in leaves no process behind
     * and the next open spawns one of its own.
     */
    void pending.catch(() => {
      if (ctx.opening === pending) ctx.opening = undefined;
      if (made === undefined) return;
      if (ctx.successfulOpening?.connection === made) ctx.successfulOpening = undefined;
      ctx.failedOpen = { connection: made, command: ran?.command ?? options.command, path: ran?.path };
      if (ctx.live === made) ctx.live = undefined;
      void made.close();
    });
    return pending;
  };

  /**
   * Read the record again, and put a new server behind the conversation when
   * what it spawns with changed.
   *
   * An edit applies at the next turn, which is the whole of the promise: the
   * turn already running finishes on the server it started on, and the turn
   * that begins after the edit is answered by a server built from what the
   * record says now. Nothing to do for a preset, whose values no running daemon
   * can edit.
   *
   * The conversation is kept by leaving `acpSessionId` where it is and letting
   * the old server go, so `open` reopens it the way it reopens one that died -
   * a resume where the server advertised that it can take one back without
   * replaying, and a load otherwise. The session's creation reads what its
   * first server is built with, so an edit made after that is one the next
   * turn spawns a server for.
   *
   * A record that can no longer be used is the turn's own refusal rather than a
   * session that died, which is why it comes back as a sentence.
   */
  const refreshOptions = (): string | undefined => {
    const live = options.presetOf;
    if (live === undefined) return undefined;
    let now: AcpOptions;
    try {
      now = live();
    }
    catch (error: unknown) {
      return `${provider}: the record cannot be used: ${messageOf(error)}`;
    }
    const holding = options as unknown as Record<string, unknown>;
    for (const key of LIVE_KEYS) {
      const value = (now as unknown as Record<string, unknown>)[key];
      if (value === undefined) delete holding[key];
      else holding[key] = value;
    }
    const said = spawnOf(now);
    if (ctx.startedWith === '' || said === ctx.startedWith) {
      ctx.startedWith = said;
      return undefined;
    }
    ctx.startedWith = said;
    const was = ctx.live;
    ctx.successfulOpening = undefined;
    ctx.live = undefined;
    ctx.opening = undefined;
    ctx.loading = false;
    // The conversation is kept by `acpSessionId`, so the old server is only
    // stopped: awaiting that close here would hold the turn on a process that
    // is no longer answering for it.
    void was?.close().catch(() => {});
    return undefined;
  };

  return { open, refreshOptions, authenticationFailure, toolsEndpoint: () => endpoint };
}
