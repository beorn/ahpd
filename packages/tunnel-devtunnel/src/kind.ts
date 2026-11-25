/**
 * The `devtunnel` kind: one port on the Dev Tunnel of a connector.
 *
 * A record is a connector, a port and whether the port is anonymous. Starting
 * it puts the port on the connector's Dev Tunnel and refreshes the relay host,
 * so the tunnel reaches this machine. The Dev Tunnel itself is the connector's
 * and is shared: two tunnels of one connector are two ports on one host.
 *
 * The system tunnel is the one the host adds for its own reachability. It
 * forwards the well-known port `31546`, which is the number a client opens,
 * and crosses the daemon's own port onto it when the two differ. Its lines and
 * its page are the ones this plugin has always said and drawn, now read
 * through the management client rather than the CLI.
 *
 * A connector that is not open is not an error in the daemon: the record says
 * why and stays, because a sign-in is the next thing the person will do.
 */

import { reason } from '@ahpd/sdk';
import type {
  KindOperation, PluginHost, ReportTunnel, Tunnel, TunnelKind,
} from '@ahpd/sdk';
import { deriveConnectionToken, displayLabel, TUNNEL_PORT } from './discovery.js';
import { carry, gate } from './forward.js';
import { notFound, unauthorized } from './service.js';
import type { Service, Shown } from './service.js';
import { sameState, tunnelView } from './view.js';
import type { TunnelState } from './view.js';

/** The kind's name, which every record of it carries. */
export const NAME = 'devtunnel';

/** What a client prints for the kind. */
export const TITLE = 'Dev Tunnel';

/** One sentence on what a tunnel of this kind is. */
export const DESCRIPTION = 'A port on a Microsoft Dev Tunnel, reached at the URL the service assigns.';

/**
 * How often the system tunnel's state is read from the service, in
 * milliseconds.
 *
 * A relay that drops and comes back shows on the plugin's page within this
 * long. The numbers change rarely, so this is slow on purpose.
 */
export const POLL_MS = 30_000;

/** The alert's ref, so one warning replaces the last. */
const REF = 'tunnel';

/** What a record says when its connector is not open. */
const NOT_OPEN = 'The connector is not open. Sign in to this connector again, then enable this tunnel.';

/**
 * What a visitor who presents the tunnel's derived token is answered on a host
 * with users and no person named.
 *
 * Nobody named the visitor, so there is nobody to admit them as, and admitting
 * them as the daemon's own operator is the thing this plugin no longer does.
 */
const REFUSED = 'This tunnel refused a visitor: the host has users and the tunnel names nobody. Set its person to `user:` and an id the users directory holds.';

/**
 * What a tunnel that names a person no key can stand for is answered with.
 *
 * A visitor is carried to the daemon as the person the record names by a key
 * the daemon minted. A record that requires the issuer admits no such key, so
 * there is nobody this tunnel could carry a visitor as; it is not started
 * rather than started and refusing every visitor.
 */
/**
 * What an anonymous tunnel to the daemon is refused with on a daemon that asks
 * for no token.
 *
 * Anyone reaches an anonymous port, and the daemon admits any connection on
 * loopback when it has no token and no users, so the tunnel would be the
 * daemon open to everyone.
 */
const OPEN_TO_ANYONE = `An anonymous tunnel on port ${String(TUNNEL_PORT)} would let anyone with its address drive this daemon, which asks for no token. Set a connection token or a users file first.`;

const NO_ISSUER_KEY = (person: string): string =>
  `This tunnel names user:${person}, who must sign in through the issuer, so a key cannot stand in for that sign-in. The tunnel needs another person.`;

/** What a tunnel of this kind is made of, as a client draws the form. */
export const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    connector: {
      type: 'string',
      minLength: 1,
      title: 'Connector',
      description: 'The devtunnel connector that signs in to the Dev Tunnels service.',
      'x-ahpd-connector': NAME,
    },
    port: {
      type: 'number',
      minimum: 1,
      maximum: 65535,
      title: 'Port',
      description: 'The port on this machine this tunnel forwards.',
    },
    anonymous: {
      type: 'boolean',
      title: 'Anonymous',
      description: 'Whether somebody who is not signed in to this account may reach the tunnel. On port 31546, a visitor then brings a token this host accepts, and VS Code over the tunnel cannot connect.',
      default: false,
    },
    person: {
      type: 'string',
      pattern: '^user:.+$',
      title: 'Person',
      description: 'Who a visitor to this tunnel is, as `user:` and the id the users directory holds them under.',
    },
    requireToken: {
      type: 'boolean',
      title: 'Require a token',
      description: 'Visitors must bring a token this host accepts. On port 31546 the derived token is not mapped, so VS Code over the tunnel cannot connect. On another port, a visitor opens the URL once with ?tkn=<token> and then carries a cookie.',
      default: false,
    },
  },
  required: ['connector', 'port'],
};

/**
 * The verbs a person may run.
 *
 * The host starts and stops a tunnel when it is enabled and disabled, so these
 * two are here to offer a person the same verbs on a row. `restart` is the one
 * that reconnects a relay without touching the Dev Tunnel, and `anonymous` is
 * the one that changes who may reach the port.
 */
export const OPERATIONS: KindOperation[] = [
  {
    id: 'start',
    label: 'Start',
    description: 'Starts the tunnel, so its address reaches this host.',
    icon: 'play',
    offered: (record) => record['status'] !== 'running',
  },
  {
    id: 'stop',
    label: 'Stop',
    description: 'Stops the tunnel. Its address stops reaching this host.',
    icon: 'stop',
    offered: (record) => record['status'] === 'running',
  },
  {
    id: 'restart',
    label: 'Restart',
    description: 'Connects the tunnel again. Its address stays the same.',
    icon: 'restart',
    offered: (record) => record['status'] === 'running',
  },
  {
    id: 'anonymous',
    label: 'Anonymous access',
    description: 'Lets people who are not signed in to this account reach the tunnel.',
    input: {
      type: 'object',
      properties: { on: { type: 'boolean', title: 'Anonymous access' } },
      required: ['on'],
    },
  },
];

/** What the kind is built with. */
export interface KindOptions {
  /** The plugin's host: the lines, alerts, page and people the kind keeps there. */
  plugin: Pick<
    PluginHost,
    'say' | 'log' | 'alert' | 'clearAlert' | 'showView' | 'clearView' | 'hasUsers' | 'personKey' | 'acceptsToken' | 'registerClose'
  >;
  /** The service its ports are put on. */
  service: Service;
  /** The connector the system tunnel uses, from the plugin's `connector` option. */
  connector?: string;
  /** Whether the system tunnel is reachable without signing in. */
  anonymous: boolean;
  /** The person the system tunnel names, from the plugin's `person` option, as `user:<id>`. */
  person?: string;
  /**
   * Whether the system tunnel requires a token of its own, from the plugin's
   * `requireToken` option.
   *
   * Off, the tunnel maps the token a client derived from its id to the person
   * it names. On, nothing is mapped: a visitor brings a token the daemon
   * accepts, and one that presents the derived token is answered as one with
   * any other token.
   */
  requireToken?: boolean;
  /** Whether a Dev Tunnel is deleted when its last port stops. */
  keep: boolean;
  /** Whether a connector is open now. */
  open(connector: string): boolean;
  /** Be told the id of each connector that holds a new token. Answers what stops it. */
  onHold?(listener: (connector: string) => void): () => void;
  /** The first wait before a start the service refused with 401 is tried again, and the longest. 30 s and 10 min when absent. */
  retryMs?: { first: number; most: number };
  /** The port the daemon bound, once `listening` has said it. */
  daemonPort(): number | undefined;
  /** Whether the daemon requires a connection token of its own. */
  guarded(): boolean;
  /** The daemon's connection token, when it requires one, which a host with no users carries in place of the derived token. */
  connectionToken?(): string | undefined;
}

/**
 * The well-known port this process carries for one tunnel.
 *
 * The handler is registered before the port goes on the tunnel, because a
 * visitor can connect the moment it is there. The token its clients derive is
 * not known until the service answers with the tunnel, so it is filled in
 * after the add; a connection that arrives in between is carried as it came,
 * which is what a visitor with no token gets anyway.
 */
interface Hop {
  /** The token a client over this tunnel presents, once the service has said the tunnel. */
  derived?: string;
  /** The person the record names, as the users directory holds them; absent names nobody. */
  person?: string;
  /** The key that person is admitted by, once minted; absent, nobody can be admitted as them. */
  key?: string;
  /** Whether every request's token is carried as the visitor wrote it. */
  requireToken: boolean;
  /**
   * Whether anyone may reach the port. The derived token is the hash of the
   * tunnel id, which is in the port's address, so while this is on a visitor's
   * token is carried as they wrote it, and the daemon decides.
   */
  anonymous: boolean;
  /** Stop carrying the port, so the next visitor is carried as the tunnel's access alone says. */
  close(): Promise<void>;
}

/** One tunnel this daemon has up, so a stop knows what to take down. */
interface Running {
  connector: string;
  port: number;
  /** The person it names, as the id the users directory holds them under. */
  person?: string;
  /** The token a client over this tunnel presents, whatever port it is on. */
  derived?: string;
  hop?: Hop;
  /** The record as it was started, so a tunnel the service lost can be started again. */
  tunnel: Tunnel;
  /** Where its start reports, which a start made again reports to as well. */
  report: ReportTunnel;
}

/** A non-empty string, or nothing. */
const textOf = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * The person a record names, as the id the users directory holds them under.
 *
 * The setting is `user:` and the id, as the schema says. Anything else names
 * nobody, and a record carrying it is refused at its start rather than at a
 * visitor's connection, where the daemon would admit nobody and say only that
 * the token was refused.
 */
const personOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return /^user:(.+)$/u.exec(value)?.[1];
};

/** A port number, or nothing. */
const numberOf = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined);

/** The kind over one service, with the tunnels it has up. */
export function devtunnelKind(options: KindOptions): TunnelKind {
  const { plugin } = options;

  /** The records this daemon has up, by id. */
  const running = new Map<string, Running>();

  /**
   * The records whose start the service refused with 401, by id: each is
   * started again when its timer ends, or sooner when its connector holds a
   * new token. The wait doubles after each refusal, up to `retryMs.most`.
   */
  const retrying = new Map<string, { connector: string; delay: number; timer: ReturnType<typeof setTimeout> }>();
  const firstWait = options.retryMs?.first ?? 30_000;
  const mostWait = options.retryMs?.most ?? 600_000;

  /** Stop trying one record again. */
  const forgetRetry = (id: string): void => {
    const held = retrying.get(id);
    if (held !== undefined) clearTimeout(held.timer);
    retrying.delete(id);
  };

  /** Try one refused record again after the wait in force, and answer that wait. */
  const retry = (tunnel: Tunnel, report: ReportTunnel, connector: string): number => {
    const before = retrying.get(tunnel.id);
    if (before !== undefined) clearTimeout(before.timer);
    const delay = before === undefined ? firstWait : Math.min(before.delay * 2, mostWait);
    const timer = setTimeout(() => { void start(tunnel, report); }, delay);
    timer.unref?.();
    retrying.set(tunnel.id, { connector, delay, timer });
    return delay;
  };

  /** Each record that waits on a connector, started again now that it holds a new token. */
  const pending = new Map<string, { tunnel: Tunnel; report: ReportTunnel }>();
  const stopListening = options.onHold?.((connector) => {
    for (const [id, held] of retrying) {
      const waiting = pending.get(id);
      if (held.connector !== connector || waiting === undefined) continue;
      clearTimeout(held.timer);
      held.timer = setTimeout(() => { void start(waiting.tunnel, waiting.report); }, 0);
      held.timer.unref?.();
    }
  });
  plugin.registerClose(() => {
    stopListening?.();
    for (const id of [...retrying.keys()]) forgetRetry(id);
    pending.clear();
  });

  /** The system tunnel's page: what was drawn, and the read behind it. */
  let poll: ReturnType<typeof setInterval> | undefined;
  let watched: { connector: string; port: number } | undefined;
  let drawn: TunnelState | undefined;
  let failing = false;

  /**
   * Read the system tunnel's state and draw it, when it is not what the page
   * shows.
   *
   * A read that fails keeps the page as it was: a short loss of the network
   * should not empty it. The first failure of a run is logged and warned on
   * the row, and the rest of that run is not, so a tunnel that stays
   * unreachable costs one line. The next good read takes the warning away.
   */
  const read = async (): Promise<void> => {
    const at = watched;
    if (at === undefined) return;
    let shown: Shown | undefined;
    try {
      shown = await options.service.show(at.connector, at.port);
    } catch (error) {
      // The service no longer has the tunnel: it is made again, as at a start.
      if (notFound(error)) {
        void remake(at.connector);
        return;
      }
      if (!failing) {
        plugin.log.error(`${NAME}: ${reason(error)}`);
        plugin.alert({ level: 'warning', ref: 'read', text: 'The tunnel\'s status could not be checked, so this page may be out of date.' });
      }
      failing = true;
      return;
    }
    // A stop, or a new port, may have happened while the service was answering.
    if (watched !== at) return;
    if (failing) plugin.clearAlert('read');
    failing = false;
    if (shown === undefined) return;
    const next: TunnelState = {
      id: shown.id,
      port: at.port,
      ...(shown.url === undefined ? {} : { url: shown.url }),
      hosts: shown.hosts,
      clients: shown.clients,
    };
    if (drawn !== undefined && sameState(drawn, next)) return;
    drawn = next;
    plugin.showView(tunnelView(next));
  };

  /** Stop the poll, empty the page and forget what it drew. */
  const unwatch = (): void => {
    clearInterval(poll);
    poll = undefined;
    watched = undefined;
    drawn = undefined;
    failing = false;
    plugin.clearAlert('read');
    plugin.clearView();
  };

  /** Watch the system tunnel: one read now, and the same question every `POLL_MS`. */
  const watch = async (connector: string, port: number): Promise<void> => {
    unwatch();
    const at = { connector, port };
    watched = at;
    await read();
    // A stop during that first read has already cleared the poll it would start.
    if (watched !== at) return;
    poll = setInterval(() => { void read(); }, POLL_MS);
  };

  /**
   * The handler that carries a tunnel's well-known port into this process.
   *
   * A visitor who presents the token derived from the tunnel's id is asking to
   * be let in as somebody, and who that is comes from the record: the person it
   * names, else - on a host with nobody to name - the daemon's own token, as the
   * hop always did. A host with users and no person has nobody to admit them as
   * and refuses the request here, before it reaches the daemon.
   *
   * Any other token, and any `Authorization` header, is carried as the client
   * wrote it, so a person signed in with their own token stays that person.
   *
   * On a host with users, a person no key can be minted for - one whose record
   * requires the issuer - is refused here: no handler is registered and the
   * start is told why, so the tunnel does not run and refuse every visitor.
   *
   * A tunnel that requires a token maps nothing. Every request is carried with
   * the token the visitor wrote, so a visitor needs a token the daemon accepts
   * and the derived token is answered as any other token is.
   *
   * A connection is dialled to the daemon's port on loopback, whichever port
   * that is; nothing on this machine listens for the tunnel otherwise.
   */
  const hopFor = async (
    connector: string,
    port: number,
    person: string | undefined,
    requireToken: boolean,
    anonymous: boolean,
  ): Promise<Hop | undefined> => {
    if (port !== TUNNEL_PORT) return requireToken ? gateFor(connector, port, anonymous) : undefined;
    const daemon = options.daemonPort();
    if (daemon === undefined) return undefined;
    const key = person === undefined ? undefined : await plugin.personKey(person);
    if (person !== undefined && plugin.hasUsers === true && key === undefined) {
      throw new Error(NO_ISSUER_KEY(person));
    }
    const hop: Hop = {
      ...(person === undefined ? {} : { person }),
      ...(key === undefined ? {} : { key }),
      requireToken,
      anonymous,
      close: async () => { options.service.carry(connector, port, undefined); },
    };
    options.service.carry(connector, port, (stream) => {
      void carry(stream, daemon, (tkn) => {
        if (hop.requireToken || hop.anonymous) return { keep: true };
        if (tkn === undefined || tkn !== hop.derived) return { keep: true };
        if (plugin.hasUsers === true) {
          if (hop.key !== undefined) return { set: hop.key };
          // No key stands for the person the record names, which a saved
          // change to a person who requires the issuer leaves: the visitor is
          // refused with what that person's record means for this tunnel.
          const why = hop.person === undefined ? REFUSED : NO_ISSUER_KEY(hop.person);
          plugin.alert({ level: 'error', ref: REF, text: why });
          return { refuse: why };
        }
        const token = options.connectionToken?.();
        return token === undefined ? { keep: true } : { set: token };
      }, plugin.log).catch((error: unknown) => {
        plugin.log.warn(`${NAME}: a tunnel connection was not carried: ${reason(error)}`);
      });
    });
    return hop;
  };

  /**
   * Whether an anonymous port would open the daemon to anyone: the daemon's own
   * port, anonymous, on a daemon with no token and no users.
   */
  const openToAnyone = (port: number, anonymous: boolean): boolean =>
    port === TUNNEL_PORT && anonymous && !options.guarded() && plugin.hasUsers !== true;

  /**
   * Refuse an anonymous port that would open the daemon, on the row and in the
   * answer: a start that puts nothing up says the record is in error, and a
   * change refused on a port says only why, leaving the port as it is.
   */
  const refuseOpen = (report: ReportTunnel, starting: boolean): void => {
    plugin.alert({ level: 'error', ref: REF, text: OPEN_TO_ANYONE });
    report(starting ? { status: 'error', error: OPEN_TO_ANYONE } : { error: OPEN_TO_ANYONE });
  };

  /**
   * The gate in front of a port that is not the daemon's: each request is
   * carried to that port on this machine only with a token the daemon
   * accepts. It is a hop that maps nothing, so a stop, a move and a restart
   * take it down as they take down the daemon's.
   */
  const gateFor = (connector: string, port: number, anonymous: boolean): Hop => {
    const hop: Hop = {
      requireToken: true,
      anonymous,
      close: async () => { options.service.carry(connector, port, undefined); },
    };
    options.service.carry(connector, port, (stream) => {
      void gate(stream, port, (token) => plugin.acceptsToken(token), plugin.log).catch((error: unknown) => {
        plugin.log.warn(`${NAME}: a gated connection was not carried: ${reason(error)}`);
      });
    });
    return hop;
  };

  /** Put one tunnel up, or say why it is not up. */
  const start = async (tunnel: Tunnel, report: ReportTunnel, again = false): Promise<void> => {
    const connector = textOf(tunnel.settings['connector']);
    const port = numberOf(tunnel.settings['port']);
    const anonymous = tunnel.settings['anonymous'] === true;
    const requireToken = tunnel.settings['requireToken'] === true;
    const named = tunnel.settings['person'];
    const person = personOf(named);

    if (connector === undefined || port === undefined) {
      report({ status: 'error', error: 'This tunnel needs a connector and a port.' });
      return;
    }
    if (named !== undefined && person === undefined) {
      report({
        status: 'error',
        error: 'This tunnel\'s person must be `user:` and the id the users directory holds them under.',
      });
      return;
    }
    // A record already up is left alone, so a second start starts nothing twice.
    if (running.has(tunnel.id)) {
      report({ status: 'running' });
      return;
    }
    if (openToAnyone(port, anonymous)) {
      plugin.log.warn(`${NAME}: tunnel ${tunnel.id} was not started: ${OPEN_TO_ANYONE}`);
      refuseOpen(report, true);
      return;
    }
    if (!options.open(connector)) {
      plugin.log.warn(`${NAME}: tunnel ${tunnel.id} was not started: connector ${connector} is not open`);
      report({ status: 'error', error: NOT_OPEN });
      return;
    }

    let hop: Hop | undefined;
    try {
      hop = await hopFor(connector, port, person, requireToken, anonymous);
      const served = await options.service.add(connector, port, anonymous);
      const derived = await deriveConnectionToken(served.remote.id);
      if (hop !== undefined) hop.derived = derived;
      running.set(tunnel.id, {
        connector,
        port,
        ...(person === undefined ? {} : { person }),
        derived,
        ...(hop === undefined ? {} : { hop }),
        tunnel,
        report,
      });
      plugin.clearAlert(REF);
      forgetRetry(tunnel.id);
      pending.delete(tunnel.id);

      if (tunnel.purpose === 'system') {
        const shown = displayLabel(served.remote.labels);
        plugin.say(`tunnel ${served.remote.id}${shown === undefined ? '' : ` (${shown})`}, port ${port}`);
        /*
         * A guarded daemon the plugin was not handed a token to set.
         *
         * A client over a tunnel presents a token it derived from the tunnel
         * id. Nothing here replaces it, so that is what the daemon sees, and
         * the line says it so the two can be made to agree.
         */
        if (options.guarded() && options.connectionToken?.() === undefined) {
          plugin.say(
            `tunnel token ${derived}`
            + ' - what a client presents over the tunnel; this daemon requires its own',
          );
        }
      }

      report({ status: 'running', ...(served.url === undefined ? {} : { url: served.url }) });
      if (tunnel.purpose === 'system') await watch(connector, port);
    } catch (error) {
      const message = reason(error);
      await hop?.close();
      // The connector's tunnel was held when the service no longer had it: it
      // is made again for every record on it, and this start is tried once more.
      if (!again && notFound(error)) {
        await remake(connector);
        await start(tunnel, report, true);
        return;
      }
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} did not start: ${message}`);
      if (tunnel.purpose === 'system' && port === TUNNEL_PORT) {
        plugin.alert({ level: 'error', ref: REF, text: `The tunnel could not use port ${TUNNEL_PORT}: ${message}` });
      }
      // A refused token may be one not yet refreshed, so the start is tried
      // again after a wait, and when the connector next holds a token.
      if (unauthorized(error)) {
        pending.set(tunnel.id, { tunnel, report });
        const wait = retry(tunnel, report, connector);
        const at = new Date(Date.now() + wait).toISOString();
        report({ status: 'error', error: `${message} It is tried again at ${at}, or when the connector holds a new token.` });
        return;
      }
      // Any other refusal is not one a wait cures, so the record stops waiting.
      forgetRetry(tunnel.id);
      pending.delete(tunnel.id);
      report({ status: 'error', error: message });
    }
  };

  /** Take one tunnel down, and the Dev Tunnel only when it was the last port. */
  const stop = async (tunnel: Tunnel, report: ReportTunnel): Promise<void> => {
    forgetRetry(tunnel.id);
    pending.delete(tunnel.id);
    const one = running.get(tunnel.id);
    if (one === undefined) {
      report({ status: 'stopped' });
      return;
    }
    running.delete(tunnel.id);
    try {
      await one.hop?.close();
      await options.service.remove(one.connector, one.port, options.keep);
    } catch (error) {
      // The port went with the tunnel the service no longer has: this record
      // is stopped, and the others of its connector start again on a new one.
      if (notFound(error)) {
        if (tunnel.purpose === 'system') unwatch();
        report({ status: 'stopped' });
        await remake(one.connector);
        return;
      }
      const message = reason(error);
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} did not stop: ${message}`);
      report({ status: 'error', error: message });
      return;
    }
    if (tunnel.purpose === 'system') unwatch();
    report({ status: 'stopped' });
  };

  /** Connect a relay again, leaving the tunnel and its ports where they are. */
  const restart = async (tunnel: Tunnel, report: ReportTunnel): Promise<void> => {
    const one = running.get(tunnel.id);
    if (one === undefined) {
      report({ status: 'stopped', error: 'The tunnel is not running, so there is no relay to connect again.' });
      return;
    }
    try {
      await options.service.restart(one.connector);
    } catch (error) {
      const message = reason(error);
      // The service no longer has the tunnel: making it again is the restart.
      if (notFound(error)) {
        await remake(one.connector);
        report(running.has(tunnel.id) ? { status: 'running' } : { status: 'error', error: message });
        return;
      }
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} was not restarted: ${message}`);
      report({ status: 'error', error: message });
      return;
    }
    report({ status: 'running' });
    if (tunnel.purpose === 'system') await read();
  };

  /** Change who may reach a port, and keep it in the record. */
  const access = async (tunnel: Tunnel, report: ReportTunnel, input: Record<string, unknown> | undefined, again = false): Promise<void> => {
    const on = input?.['on'];
    if (typeof on !== 'boolean') throw new Error('anonymous access needs `on`, a boolean');
    const one = running.get(tunnel.id);
    if (openToAnyone(one?.port ?? numberOf(tunnel.settings['port']) ?? 0, on)) {
      plugin.log.warn(`${NAME}: tunnel ${tunnel.id} kept its access: ${OPEN_TO_ANYONE}`);
      refuseOpen(report, false);
      return;
    }
    if (one !== undefined) {
      // The hop stops mapping before the port opens to anyone, and maps again
      // only once it is closed, so no anonymous moment maps the derived token.
      const was = one.hop?.anonymous;
      if (on && one.hop !== undefined) one.hop.anonymous = true;
      try {
        await options.service.access(one.connector, one.port, on);
      } catch (error) {
        const message = reason(error);
        if (one.hop !== undefined && was !== undefined) one.hop.anonymous = was;
        // The service no longer has the tunnel: it is made again, and the
        // change is asked of the new one once.
        if (!again && notFound(error)) {
          await remake(one.connector);
          await access(tunnel, report, input, true);
          return;
        }
        plugin.log.warn(`${NAME}: tunnel ${tunnel.id} kept its access: ${message}`);
        report({ error: message });
        return;
      }
      if (!on && one.hop !== undefined) one.hop.anonymous = false;
    }
    // Saved by the host, so the next start puts the port on with this access.
    report({ settings: { anonymous: on } });
  };

  /** The connectors whose tunnel is being made again, so two failures make it once. */
  const remaking = new Set<string>();

  /**
   * Make a connector's Dev Tunnel again, for a tunnel the service no longer
   * has: every record on it is taken down here, the held tunnel let go, and
   * each record started again with the report it was started with. The start
   * finds the tunnel by name or makes it, as at a daemon's start, so it has a
   * new id, address and derived token. VS Code's CLI deletes an unused tunnel
   * carrying the launcher label when an account is at its limit.
   * https://github.com/microsoft/vscode/blob/53fa24195c2/cli/src/tunnels/dev_tunnels.rs#L808-L835
   */
  const remake = async (connector: string): Promise<void> => {
    if (remaking.has(connector)) return;
    remaking.add(connector);
    try {
      plugin.log.warn(`${NAME}: the Dev Tunnel of connector ${connector} is gone from the service; making it again`);
      const ours = [...running.entries()].filter(([, one]) => one.connector === connector);
      for (const [id, one] of ours) {
        running.delete(id);
        await one.hop?.close();
        if (one.tunnel.purpose === 'system') unwatch();
      }
      await options.service.forget(connector);
      for (const [, one] of ours) await start(one.tunnel, one.report, true);
    }
    finally {
      remaking.delete(connector);
    }
  };

  return {
    name: NAME,
    title: TITLE,
    description: DESCRIPTION,
    schema: SCHEMA,
    operations: OPERATIONS,

    create: start,

    remove: async (tunnel) => {
      forgetRetry(tunnel.id);
      pending.delete(tunnel.id);
      const one = running.get(tunnel.id);
      running.delete(tunnel.id);
      if (tunnel.purpose === 'system') unwatch();
      if (one === undefined) return;
      await one.hop?.close();
      try {
        await options.service.remove(one.connector, one.port, options.keep);
      } catch (error) {
        // The record is going anyway: a port left on the service is a port the
        // next start writes again, and a person who removed the row asked for
        // the row to go.
        plugin.log.warn(`${NAME}: tunnel ${tunnel.id} was removed but its port was not: ${reason(error)}`);
      }
    },

    invoke: async (name, tunnel, report, input) => {
      if (name === 'start') { await start(tunnel, report); return; }
      if (name === 'stop') { await stop(tunnel, report); return; }
      if (name === 'restart') { await restart(tunnel, report); return; }
      if (name === 'anonymous') { await access(tunnel, report, input); return; }
      throw new Error(`${NAME} does not offer ${name}`);
    },

    update: async (tunnel, input, report) => {
      const one = running.get(tunnel.id);
      if (one === undefined) {
        report({ status: 'stopped' });
        return;
      }
      const connector = textOf(input['connector']) ?? one.connector;
      const port = numberOf(input['port']) ?? one.port;
      const anonymous = input['anonymous'] === true;
      const requireToken = tunnel.settings['requireToken'] === true;
      const person = personOf(tunnel.settings['person']);

      if (openToAnyone(port, anonymous)) {
        plugin.log.warn(`${NAME}: tunnel ${tunnel.id} kept its access: ${OPEN_TO_ANYONE}`);
        refuseOpen(report, false);
        return;
      }

      if (connector !== one.connector) {
        // Another account: the old port goes with the old connector, and the
        // tunnel starts again on the new one.
        running.delete(tunnel.id);
        try {
          await options.service.remove(one.connector, one.port, options.keep);
        } catch (error) {
          report({ status: 'error', error: reason(error) });
          return;
        }
        await one.hop?.close();
        if (tunnel.purpose === 'system') unwatch();
        await start(tunnel, report);
        return;
      }

      if (port !== one.port) {
        let hop: Hop | undefined;
        try {
          // The new port's handler goes in before the port moves, because a
          // visitor can connect the moment the service answers it, and the
          // token stays the same: the Dev Tunnel's id does not change.
          hop = await hopFor(connector, port, person, requireToken, anonymous);
          if (hop !== undefined && one.derived !== undefined) hop.derived = one.derived;
          const url = await options.service.replace(connector, one.port, port, anonymous);
          await one.hop?.close();
          running.set(tunnel.id, {
            connector,
            port,
            ...(person === undefined ? {} : { person }),
            ...(one.derived === undefined ? {} : { derived: one.derived }),
            ...(hop === undefined ? {} : { hop }),
            tunnel,
            report: one.report,
          });
          report({ status: 'running', ...(url === undefined ? {} : { url }) });
          if (tunnel.purpose === 'system') await watch(connector, port);
        } catch (error) {
          await hop?.close();
          // The service no longer has the tunnel: it is made again, the record
          // starting on the port it now names.
          if (notFound(error)) {
            one.tunnel = tunnel;
            await remake(connector);
            return;
          }
          report({ status: 'error', error: reason(error) });
        }
        return;
      }

      /*
       * A `requireToken` named or changed on the running port is read by the
       * handler at the next request, so it applies without moving the port and
       * without a new key: the setting only decides whether a token is mapped.
       */
      if (one.hop !== undefined) one.hop.requireToken = requireToken;
      /*
       * On a port that is not the daemon's, `requireToken` is the gate itself:
       * turned on, the gate goes in front of the port, and turned off, the port
       * is piped as it is again.
       */
      if (port !== TUNNEL_PORT) {
        if (requireToken && one.hop === undefined) one.hop = gateFor(connector, port, anonymous);
        else if (!requireToken && one.hop !== undefined) {
          await one.hop.close();
          delete one.hop;
        }
      }

      // A person named or changed on the running port is who the next visitor
      // is admitted as. The handler reads the hop, so the key changes in place
      // and no visitor is carried by a tunnel whose record names somebody else.
      if (person !== one.person) {
        if (one.hop !== undefined) {
          let key: string | undefined;
          if (person !== undefined && plugin.hasUsers === true) {
            try { key = await plugin.personKey(person); }
            catch (error) {
              // The directory has no such person, so nobody is admitted as
              // them: the port stops admitting on the derived token rather
              // than keep the person the record no longer names.
              delete one.hop.key;
              one.hop.person = person;
              report({ status: 'error', error: reason(error) });
              return;
            }
            if (key === undefined) {
              // The person signs in through the issuer, so no key stands for
              // them. Nobody is admitted as them either, and the record says
              // why rather than admitting the person it no longer names.
              delete one.hop.key;
              one.hop.person = person;
              report({ status: 'error', error: NO_ISSUER_KEY(person) });
              return;
            }
          }
          if (key === undefined) delete one.hop.key;
          else one.hop.key = key;
          if (person === undefined) delete one.hop.person;
          else one.hop.person = person;
        }
        running.set(tunnel.id, {
          connector,
          port,
          ...(person === undefined ? {} : { person }),
          ...(one.derived === undefined ? {} : { derived: one.derived }),
          ...(one.hop === undefined ? {} : { hop: one.hop }),
          tunnel,
          report: one.report,
        });
        report({ status: 'running' });
        return;
      }

      // In the order `access` takes: the hop stops mapping before the port
      // opens to anyone, and maps again only once it is closed.
      const was = one.hop?.anonymous;
      if (anonymous && one.hop !== undefined) one.hop.anonymous = true;
      try {
        await options.service.access(connector, port, anonymous);
      } catch (error) {
        if (one.hop !== undefined && was !== undefined) one.hop.anonymous = was;
        // The service no longer has the tunnel: it is made again with the
        // record as it was saved, its new access among it.
        if (notFound(error)) {
          one.tunnel = tunnel;
          await remake(connector);
          return;
        }
        report({ error: reason(error) });
        return;
      }
      if (!anonymous && one.hop !== undefined) one.hop.anonymous = false;
      one.tunnel = tunnel;
      report({ status: 'running' });
    },

    system: () => {
      const connector = options.connector;
      if (connector === undefined) {
        plugin.alert({
          level: 'warning',
          ref: REF,
          text: 'Sign in to a devtunnel connector on this host, then set the plugin option `connector` to it. No tunnel is opened until then.',
        });
        return undefined;
      }
      return {
        connector,
        port: TUNNEL_PORT,
        anonymous: options.anonymous,
        ...(options.person === undefined ? {} : { person: options.person }),
        ...(options.requireToken === true ? { requireToken: true } : {}),
      };
    },
  };
}
