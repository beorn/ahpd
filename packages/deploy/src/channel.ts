/**
 * The deploy driver as one channel, `x-hh-deploys://`, whose action is its one
 * operation (#38276; ADR-004 amendment 6, @cto 2026-11-25).
 *
 * A client subscribes to `x-hh-deploys://` and reads one row per deploy this
 * machine has on record, plus the deploy running now. The snapshot lists the
 * operation, `deploy`, under `deploy:deploy`, and `x-ahpd/invokeOperation` runs
 * it. A run's live status is a subscribe to its own URI,
 * `x-hh-deploys://<deployId>`: a per-record URI is a channel URI, so it needs
 * no resource scheme of its own. What is read with `resourceRead` — a run's
 * journal — is `hh-deploys://<deployId>/log`, plain, because the host keeps
 * `x-` for protocol extensions and refuses it as a resource scheme.
 *
 * The split is a fact about time rather than taste: a deploy runs minutes (a
 * fetch, a build, a check) while an AHP host request is capped at seconds. The
 * operation checks, starts the child and answers `started <deployId>` at once;
 * the row for that id says what the journal says ever after.
 *
 * Like the rest of this package it imports nothing of `@ahpd/sdk`. The shapes
 * below are the members of the sdk's types it uses, and a test checks that
 * they agree.
 */
import { readJournal, status } from './index.js';
import type { DeployLayout } from './index.js';

/** The channel's scheme, and its one URI. */
export const SCHEME = 'x-hh-deploys';
export const CHANNEL = `${SCHEME}://`;
/** The scheme a run's journal is read on. Not `x-`: the host keeps that for protocol extensions. */
export const READS_SCHEME = 'hh-deploys';
/** The action a subscriber is sent when a deploy's record changes: the whole new state, never a patch. */
export const CHANGED = `${SCHEME}/changed`;
/** The grant subject every operation and read here names. */
export const SUBJECT = 'deploy';
/**
 * The words the subject's grants are made of: one to deploy, one to read a run's status and journal.
 * `status`, not `read`: the sdk reserves `read`/`write`/`*` as group names, so an operation may not be called `read`
 * (`plugin-grants.test.ts`: "refuses an operation that is a group or the wildcard"). The plugin failed to load on
 * the first host because of exactly that.
 */
export const GRANT_WORDS = ['deploy', 'status'] as const;

/** A grant as the sdk spells it. */
type Grant = `${string}:${string}`;

/** Who a channel or a read is asked by: the members of the sdk's `Principal` this uses. */
export interface Reader {
  readonly id: string;
  can(grant: Grant): boolean;
}

/** Who sent an operation, as `invokeOperation` tells `run`: the sdk's `OperationCaller`. */
export interface OperationCaller {
  readonly client: string;
  readonly owner?: string;
}

/** One operation as the snapshot lists it: the members of the sdk's `Operation` this sets. */
export interface DeployOperation {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description: string;
  readonly scopes: string[];
  readonly grant: Grant;
  readonly status: 'idle';
  readonly input?: Record<string, unknown>;
}

const schema = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: 'object', properties, required });

/**
 * The one operation. `service` and `version` are the whole call: the
 * declaration (repository, ref and the steps) is the service's own record, under
 * its `x-hh-deploy` key (#38549, @cto 2026-11-25). Holding `deploy:deploy`
 * therefore chooses what to place live, never a command to run as the host.
 */
export const OPERATION: DeployOperation = {
  id: 'deploy',
  kind: SUBJECT,
  label: 'Deploy',
  description: 'Places one of this machine\'s services at a version: fetches, builds, switches one symlink, checks. Answers the started deploy; its row says how it went, and its journal is at hh-deploys://<deployId>/log.',
  scopes: [SUBJECT],
  grant: `${SUBJECT}:deploy`,
  status: 'idle',
  input: schema({
    service: { type: 'string', description: 'The service on this machine, as the services channel lists it; its record carries the deploy declaration.' },
    version: { type: 'string', description: 'A branch, a tag or a commit sha the declared ref can reach from the record.' },
  }, ['service', 'version']),
};

/**
 * An error the host answers with its own code and data: the sdk knows one by
 * its shape, named `RpcError` with a numeric code, because this package has no
 * copy of the sdk's class.
 */
export const rpcError = (code: number, message: string, data?: Record<string, unknown>): Error & { code: number; data?: Record<string, unknown> } =>
  Object.assign(new Error(message), { name: 'RpcError', code, ...(data === undefined ? {} : { data }) });

/** A driver refusal as the error an operation answers: its code and sentence kept as data, never a bare throw. */
export const refusalError = (refusal: { readonly code: string; readonly message: string }): Error & { code: number; data?: Record<string, unknown> } =>
  rpcError(refusal.code === 'DRIVER_FAILED' ? -32603 : -32602, refusal.message, { code: refusal.code });

/** One deploy as the channel shows it: what the journal says, plus the lock if it still runs. */
export interface DeployRow {
  readonly service: string;
  readonly deployId: string;
  /** `running`, `started`, or the last event the journal wrote for it. */
  readonly state: string;
  readonly step?: string;
  readonly from?: string | null;
  readonly to?: string;
  readonly at?: string;
  /** The last journal entry for this deploy, whole, so a reader never guesses from the four fields above. */
  readonly last?: Readonly<Record<string, unknown>>;
}

/** What a subscriber to `x-hh-deploys://` holds. */
export interface DeploysState {
  readonly machine: string;
  readonly runs: readonly DeployRow[];
  readonly operations: readonly DeployOperation[];
  /** Why part of the state could not be read, when it could not: never a quiet empty list. */
  readonly error?: string;
}

/** What the channel needs of the plugin around it. */
export interface ChannelContext {
  /** This machine's name, as the services channel prints it. */
  readonly machine: string;
  /** Every service this machine runs, by name. */
  readonly services: () => readonly string[];
  /** Where one service's deploy state sits. */
  readonly layout: (service: string) => DeployLayout;
  /** The state now. */
  state(): DeploysState;
  /** Run the one operation; the driver's own checks and the answer it gives. */
  deploy(input: Record<string, unknown>, caller: OperationCaller): Promise<unknown>;
}

const entryOf = (service: string, layout: DeployLayout): { rows: DeployRow[]; why?: string } => {
  let journal: readonly Readonly<Record<string, unknown>>[];
  try {
    journal = readJournal(layout);
  } catch (error) {
    return { rows: [], why: `the journal of ${service} could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  const rows: DeployRow[] = [];
  const seen = new Set<string>();
  for (const entry of [...journal].reverse()) {
    const deployId = entry['deployId'];
    if (typeof deployId !== 'string' || deployId === '' || seen.has(deployId)) continue;
    seen.add(deployId);
    rows.push({
      service,
      deployId,
      state: typeof entry['event'] === 'string' ? entry['event'] : 'recorded',
      ...(typeof entry['step'] === 'string' ? { step: entry['step'] } : {}),
      ...(entry['from'] === null || typeof entry['from'] === 'string' ? { from: entry['from'] as string | null } : {}),
      ...(typeof entry['to'] === 'string' ? { to: entry['to'] } : {}),
      ...(typeof entry['at'] === 'string' ? { at: entry['at'] } : {}),
      last: entry,
    });
  }
  return { rows };
};

/** The state: the running deploy of every service first, then each service's record, newest first. */
export function deploysState(machine: string, services: readonly string[], layoutOf: (service: string) => DeployLayout): DeploysState {
  const runs: DeployRow[] = [];
  const problems: string[] = [];
  for (const service of services) {
    const layout = layoutOf(service);
    let running: DeployRow | undefined;
    try {
      const lock = status(layout).lock;
      if (lock !== undefined) running = { service, deployId: lock.deployId, state: 'running', step: lock.step, from: lock.from, to: lock.to, at: lock.startedAt };
    } catch (error) {
      problems.push(`the lock of ${service} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (running !== undefined) runs.push(running);
    const read = entryOf(service, layout);
    if (read.why !== undefined) problems.push(read.why);
    for (const row of read.rows) if (row.deployId !== running?.deployId) runs.push(row);
  }
  return { machine, runs, operations: [OPERATION], ...(problems.length === 0 ? {} : { error: problems.join('; ') }) };
}

/** The deploy id a `x-hh-deploys://<id>` URI names, or nothing for the channel itself. */
export const runOf = (uri: string): string | undefined => {
  if (!uri.startsWith(CHANNEL)) return undefined;
  const rest = uri.slice(CHANNEL.length);
  if (rest === '' || rest.includes('/') || rest.includes('?')) return undefined;
  return decodeURIComponent(rest);
};

/** The deploy id a `hh-deploys://<id>/log` URI names, or nothing for any other URI. */
export const logOf = (uri: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${READS_SCHEME}:` || url.pathname !== '/log' || url.host === '') return undefined;
  return decodeURIComponent(url.host);
};

/** The channel as the host takes it: the members of the sdk's `PluginChannel` this uses. */
export interface DeploysChannel {
  readonly grant: Grant;
  snapshot(uri: string): unknown;
  describe(): { title: string; description?: string };
  readonly operations: {
    operations(): DeployOperation[];
    offers(target: string, operationId: string): boolean;
    run(operation: { readonly id: string }, target: string | undefined, input: Record<string, unknown> | undefined, reader: Reader | undefined, caller?: OperationCaller): Promise<unknown>;
  };
}

/** `x-hh-deploys://`: the channel, the per-run URIs, and the one operation. */
export function deploysChannel(context: ChannelContext): DeploysChannel {
  const state = (): DeploysState => context.state();
  return {
    grant: `${SUBJECT}:status`,
    snapshot: (uri) => {
      const asked = runOf(uri);
      if (asked === undefined) return state();
      const found = state().runs.find((one) => one.deployId === asked);
      // Never an empty answer for a run that is not here: a subscriber to a made-up id is told so.
      return found ?? { machine: context.machine, deployId: asked, error: `no deploy ${asked} on ${context.machine}; the channel lists the ones it has` };
    },
    describe: () => ({ title: 'Deploys', description: `This machine's deploys: what is running, how the last one went, and the journal of each.` }),
    operations: {
      operations: () => [OPERATION],
      // One service is one deploy at a time, and only a service this machine runs is a target.
      offers: (target, operationId) => operationId === OPERATION.id && context.services().includes(target),
      run: async (asked, target, input, reader, caller) => {
        if (asked.id !== OPERATION.id) throw new Error(`No operation called ${asked.id} on ${CHANNEL}; this channel has ${OPERATION.id}`);
        const given = input ?? {};
        const service = target ?? (typeof given['service'] === 'string' ? given['service'] : undefined);
        // The target is the record; the input repeats it so one call reads the same whichever a client fills in.
        if (service === undefined) throw new Error(`${OPERATION.id} runs on one ${SUBJECT}, so it needs target.id or input.service`);
        return await context.deploy({ ...given, service }, { client: caller?.client ?? 'unknown', ...(caller?.owner === undefined ? {} : { owner: caller.owner }) });
      },
    },
  };
}

/** One of this plugin's resource schemes, as the host takes it: the members of the sdk's `ResourceProvider` this uses. */
export interface DeploysProvider {
  describe(): { title: string; description?: string };
  authorize(uri: string, reader: Reader | undefined): Promise<boolean>;
  read(uri: string, wanted?: string, reader?: Reader): Promise<{ data: string; encoding: 'utf-8'; contentType: string }>;
}

const journalText = (layout: DeployLayout, deployId: string): string => {
  const lines = readJournal(layout).filter((entry) => entry['deployId'] === deployId);
  if (lines.length === 0) throw new Error(`no deploy ${deployId} in the journal of ${layout.service}; nothing to read`);
  return lines.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
};

/** `hh-deploys://<deployId>/log`: one deploy's journal lines, under `deploy:status`. */
export function deploysProvider(context: ChannelContext): DeploysProvider {
  return {
    describe: () => ({ title: 'A deploy', description: `One deploy on ${context.machine}: its journal at ${READS_SCHEME}://<deployId>/log.` }),
    // The journal can carry a service's own text, so a reader needs the grant; nothing here widens it.
    authorize: async (uri, reader) => reader !== undefined && logOf(uri) !== undefined && reader.can(`${SUBJECT}:status`),
    read: async (uri) => {
      const deployId = logOf(uri);
      if (deployId === undefined) throw new Error(`${uri} is not a resource this machine serves; ${READS_SCHEME}:// serves <deployId>/log`);
      const found = context.state().runs.find((one) => one.deployId === deployId);
      if (found === undefined) throw new Error(`no deploy ${deployId} on ${context.machine}; nothing to read`);
      return { data: journalText(context.layout(found.service), deployId), encoding: 'utf-8', contentType: 'application/x-ndjson' };
    },
  };
}
