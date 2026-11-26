/**
 * The operations a channel lists in its state, and the one command that runs them.
 *
 * A channel whose state carries `operations` offers what a client may do to it,
 * as a changeset's state does: each operation has an `id`, a `label`, the grant
 * a caller needs, the `scopes` it takes and, where it asks for one, an `input`
 * JSON Schema. A tunnel list offers the host's four kinds of operation beside
 * the ones each kind declares, and a computer list may offer its own.
 *
 * One command serves every channel that has operations: `x-ahpd/invokeOperation`
 * takes `{ channel, operationId, target?, input? }`. It copies
 * `invokeChangesetOperation`'s checks - the operation has to be one the channel
 * lists *now*, an operation on one record takes `target: { id }`, a `list`
 * operation takes no target - and adds the two a tunnel needs: the `input` is
 * checked against the operation's own schema, and the operation's status is set
 * while it runs, so every subscriber sees the call.
 *
 * The command's own grant is `operation:invoke`, and a caller who holds the
 * operation's grant is let in without it: a person who may change the tunnels
 * may run a change to one, and needs no second grant to do it. Each operation
 * still needs its own grant, so `operation:invoke` alone runs none of them.
 *
 * The command never runs an operation itself. It finds the channel, checks what
 * the call says, and hands the operation to the channel, which answers with the
 * record, or `{}` for an operation that removed it.
 */

import { secretFields } from '../channels/owners.js';
import { refusalReason } from '../host/gate.js';
import { listedOperations } from '../plugins/validate.js';
import { HOST_CATALOGS, translated, type Catalogs } from '../i18n.js';
import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { reason } from '../utils/values.js';
import type { ChannelOperation, KindOperation, Operation, OperationScope, OperationStatus } from '../types/kinds.js';
import type { RecordsChannel } from '../resources/recordschannel.js';
import type { ChannelHandle, PluginChannel, PluginMethod } from '../types/plugin.js';
import type { Owner } from '../types/usage.js';
import type { Grant, Principal } from '../types/users.js';

/**
 * Where one operation's text is: the field path before `label`,
 * `description` or `confirmation`, and the catalogs read for it, first first.
 */
export interface OperationText {
  path: readonly string[];
  catalogs: readonly (Catalogs | undefined)[];
}

/**
 * The operations as a reader in `locale` reads them.
 *
 * Each label, description and confirmation is looked up at its field path, and
 * keeps its English where no catalog has it. A field an operation does not
 * have stays absent. No locale is English, as for every other text.
 */
export const operationsIn = (
  operations: readonly Operation[],
  locale: string | undefined,
  textOf: (operation: Operation) => OperationText,
): Operation[] => {
  if (locale === undefined) return [...operations];
  return operations.map((operation) => {
    const { path, catalogs } = textOf(operation);
    const text = (field: string, english: string): string => translated([...path, field], english, locale, ...catalogs);
    return {
      ...operation,
      ...(operation.label === undefined ? {} : { label: text('label', operation.label) }),
      ...(operation.description === undefined ? {} : { description: text('description', operation.description) }),
      ...(operation.confirmation === undefined ? {} : { confirmation: text('confirmation', operation.confirmation) }),
    };
  });
};

/**
 * The text of one of the host's own operations: `operations.<row>.<name>` in
 * the host's catalogs, where `<name>` is the id after its kind, so a tunnel's
 * `devtunnel/remove` reads `operations.tunnel.remove`.
 */
export const hostOperationText = (row: string) => (operation: Operation): OperationText => ({
  path: ['operations', row, operation.id.slice(operation.id.lastIndexOf('/') + 1)],
  catalogs: [HOST_CATALOGS],
});

/**
 * A records channel whose snapshot lists its operations beside the records, in
 * the reader's locale, as the tunnel and client lists do. A client draws a
 * row's buttons from this list, and the row's `operations` names which apply.
 */
export const withOperations = (
  records: RecordsChannel,
  operations: () => Operation[],
  textOf: (operation: Operation) => OperationText,
): RecordsChannel => {
  let handle: ChannelHandle | undefined;
  return {
    ...records,
    channel: {
      ...records.channel,
      snapshot: async (asked, reader, client) => {
        const state = await records.channel.snapshot(asked, reader, client) as Record<string, unknown>;
        return { ...state, operations: operationsIn(operations(), handle?.localeOf?.(client), textOf) };
      },
    },
    bind: (given) => {
      handle = given;
      records.bind(given);
    },
  };
};

/** What a kind gives `kindOperations` and `kindOffers`: its name, its words, its form and its own verbs. */
export interface KindShape {
  /** The kind's name, the part of each operation id before the slash. */
  name: string;
  /** What a client prints for the kind, and the label of its create. */
  title: string;
  /** One sentence on what a record of the kind is, and the description of its create. */
  description?: string;
  /** The JSON Schema of a record, which create and update take as their input. */
  schema: Record<string, unknown>;
  /** The kind's own verbs. */
  operations?: readonly KindOperation[];
}

/** How a channel's operations of one kind are built: its grants, its scope and its words. */
export interface KindOperationsOptions {
  /** The subject of the grants: `<subject>:put` for every operation but remove, and `<subject>:delete` for remove. */
  subject: string;
  /** The scope of an operation on one record, such as `tunnel` or `todo`. */
  scope: OperationScope;
  /** How the last call of one operation went, by its id. */
  status: (id: string) => { status: OperationStatus; error?: string };
  /** Whether the kind is updated, so `<kind>/update` is listed. */
  update: boolean;
  /** What update and remove say: their descriptions, where the channel has them, and the question before a remove. */
  words: { update?: string; remove?: string; confirmation: string };
}

/**
 * The operations a channel lists for one kind: `<kind>/create`, then
 * `<kind>/update` where the kind is updated, `<kind>/remove`, and each of the
 * kind's own as `<kind>/<id>`. A channel that serves more of its own, as the
 * tunnels' enable and disable, adds them.
 */
export const kindOperations = (kind: KindShape, options: KindOperationsOptions): Operation[] => {
  const named = (name: string): string => `${kind.name}/${name}`;
  const put = `${options.subject}:put`;
  const out: Operation[] = [{
    id: named('create'),
    kind: kind.name,
    label: kind.title,
    ...(kind.description === undefined ? {} : { description: kind.description }),
    input: kind.schema,
    scopes: ['list'],
    grant: put,
    ...options.status(named('create')),
  }];
  if (options.update) {
    out.push({
      id: named('update'),
      kind: kind.name,
      label: 'Edit',
      ...(options.words.update === undefined ? {} : { description: options.words.update }),
      input: kind.schema,
      scopes: [options.scope],
      grant: put,
      ...options.status(named('update')),
    });
  }
  out.push({
    id: named('remove'),
    kind: kind.name,
    label: 'Remove',
    ...(options.words.remove === undefined ? {} : { description: options.words.remove }),
    confirmation: options.words.confirmation,
    scopes: [options.scope],
    grant: `${options.subject}:delete`,
    ...options.status(named('remove')),
  });
  for (const operation of kind.operations ?? []) {
    out.push({
      id: named(operation.id),
      kind: kind.name,
      label: operation.label ?? operation.id,
      ...(operation.description === undefined ? {} : { description: operation.description }),
      ...(operation.icon === undefined ? {} : { icon: operation.icon }),
      ...(operation.input === undefined ? {} : { input: operation.input }),
      ...(operation.confirmation === undefined ? {} : { confirmation: operation.confirmation }),
      scopes: [options.scope],
      grant: operation.grant ?? put,
      ...options.status(named(operation.id)),
    });
  }
  return out;
};

/**
 * The ids of the operations one row of a kind offers now: `<kind>/update`
 * where the kind is updated, `<kind>/remove`, and each of the kind's own whose
 * `offered` answers true for the row, or that declares none.
 */
export const kindOffers = (kind: KindShape, row: Record<string, unknown>, update: boolean): string[] => {
  const named = (name: string): string => `${kind.name}/${name}`;
  const ids: string[] = [];
  if (update) ids.push(named('update'));
  ids.push(named('remove'));
  for (const operation of kind.operations ?? []) {
    if (operation.offered === undefined || operation.offered(row)) ids.push(named(operation.id));
  }
  return ids;
};

/** The grant the one command needs, and the name it is served under. */
export const OPERATION_COMMAND = 'x-ahpd/invokeOperation';
export const OPERATION_GRANT = 'operation:invoke' as Grant;

/**
 * One channel that lists operations, as the command reads it.
 *
 * The host keeps who may run what: `begin` and `settle` are where a list
 * operation's status lives, and a tunnel operation's `operation` field, so a
 * caller is never told more than the channel's readers are.
 */
export interface OperationChannel {
  /** The channel URI the state is read at, such as `x-ahpd-tunnels://`. */
  uri: string;
  /** Every operation the channel offers now, each with its status. */
  operations(): ChannelOperation[];
  /** Say one operation has started, on a record or on the list when there is none. */
  begin(operationId: string, target: string | undefined): void;
  /** Say one operation is done, or failed with its error. */
  settle(operationId: string, target: string | undefined, error?: string): void;
  /**
   * Whether one record offers an operation now, as its `operations` says.
   *
   * Asked after the target is read and before the input is checked or the call
   * begins. `reader` is who called, so a record that is not theirs is refused
   * here; it is nobody on the root connection and on a host with no users
   * directory. Absent, a channel takes every operation it lists on any target.
   */
  offers?(target: string, operationId: string, reader?: Principal): boolean | Promise<boolean>;
  /**
   * Do what the operation says, and answer the caller with the record or `{}`.
   *
   * `caller` is who sent the command, exactly as a `PluginMethod` is told:
   * `client` is the id the connection gave at `initialize` or `reconnect`, and
   * `owner` is whose work it is, which the host resolved for that connection -
   * the person a relaying plugin acts for, else the caller's own principal, and
   * nobody on a host with no users directory. Neither is ever read from the
   * request, so nothing in `input` can name another owner. A channel that
   * records who changed something records `owner`.
   */
  run(
    operation: ChannelOperation,
    target: string | undefined,
    input: Record<string, unknown> | undefined,
    reader: Principal | undefined,
    caller?: OperationCaller,
  ): Promise<unknown>;
}

/** Who sent an `invokeOperation`, as the host gives a `PluginMethod` the same two. */
export interface OperationCaller {
  client: string;
  owner?: Owner;
}

/** How the command finds a channel and checks what it was sent. */
export interface InvokeOperationOptions {
  /** Every channel that offers operations, by URI, read at each call. */
  channels(): Record<string, OperationChannel>;
  /**
   * Check one value against an operation's schema, throwing the first finding.
   *
   * Taken as an option rather than imported: the sdk takes no third-party
   * runtime, and the schema checker the daemon uses belongs to the server.
   */
  check(value: unknown, schema: Record<string, unknown>, label: string): void;
  /** Where a failed operation is said, as one line. */
  onProblem?(message: string): void;
}

/**
 * The target an operation takes, or a refusal saying which scope it has.
 *
 * Every scope but `list` names one thing, so any of them takes `target: { id }`
 * and no scope is special-cased here: a `tunnel` operation and a `client` one
 * are checked the same way, and the refusal says which it was.
 */
const targetOf = (operation: ChannelOperation, asked: unknown): string | undefined => {
  const scope = operation.scopes.find((one) => one !== 'list');
  if (asked === undefined) {
    if (scope !== undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one ${scope}, so it needs target.id`);
    return undefined;
  }
  if (scope === undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on the list, so it takes no target`);
  const raw = typeof asked === 'object' && asked !== null && !Array.isArray(asked)
    ? asked as Record<string, unknown>
    : undefined;
  const id = raw?.id;
  if (typeof id !== 'string' || id === '') {
    throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one ${scope}, so it takes target: { id }`);
  }
  return id;
};

/** The input an operation takes, checked against its schema, or a refusal. */
const inputOf = (
  operation: ChannelOperation,
  asked: unknown,
  check: InvokeOperationOptions['check'],
): Record<string, unknown> | undefined => {
  if (asked === undefined) {
    // A schema's own required fields are asked of a form with nothing filled in.
    if (operation.input !== undefined) check({}, operation.input, `${operation.id}'s input`);
    return undefined;
  }
  if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) {
    throw new RpcError(INVALID_PARAMS, `${operation.id} takes input as a JSON object`);
  }
  const input = operation.input === undefined
    ? asked as Record<string, unknown>
    : withoutEmptied(asked as Record<string, unknown>, operation.input, check);
  if (operation.input !== undefined) check(input, operation.input, `${operation.id}'s input`);
  return input;
};

/**
 * The input without each optional top-level field that is `""` where its own
 * schema refuses `""`: a form sends an emptied field as `""`, and such a field
 * holds no value then. A required field keeps its `""`, so its refusal stands.
 * A secret keeps it too: a blank secret means the stored one stays.
 */
const withoutEmptied = (
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
  check: InvokeOperationOptions['check'],
): Record<string, unknown> => {
  const properties = typeof schema.properties === 'object' && schema.properties !== null
    ? schema.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const secrets = secretFields(schema);
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = properties[key];
    if (value === '' && !required.includes(key) && !secrets.includes(key) && typeof field === 'object' && field !== null && !takes(field as Record<string, unknown>, check)) continue;
    kept[key] = value;
  }
  return kept;
};

/** Whether a field's schema takes `""`. */
const takes = (field: Record<string, unknown>, check: InvokeOperationOptions['check']): boolean => {
  try {
    check('', field, 'field');
    return true;
  } catch {
    return false;
  }
};

/**
 * The `x-ahpd/invokeOperation` command over the channels that offer operations.
 *
 * The command is synchronous in what it refuses: the channel, the operation and
 * the target are all read before anything runs. The operation's own work is
 * awaited, and its status is `running` from the moment it starts to the moment
 * it answers, or to `error` with its message when it throws.
 */
export const invokeOperation = (options: InvokeOperationOptions): PluginMethod => ({
  grant: OPERATION_GRANT,
  authorize: async (params, reader) => {
    const uri = typeof params.channel === 'string' ? params.channel : '';
    const channel = options.channels()[uri];
    if (channel === undefined) return false;
    const operationId = typeof params.operationId === 'string' ? params.operationId : '';
    let offered: ChannelOperation | undefined;
    // A list that cannot be read lets nobody in. The channel has said why.
    try { offered = channel.operations().find((one) => one.id === operationId); }
    catch { return false; }
    return offered !== undefined && reader.can(offered.grant as Grant);
  },
  describe: () => ({
    title: 'Invoke an operation',
    description: 'Runs one operation a channel offers now, with the input it asks for.',
  }),
  handle: async (params, reader, client, owner) => {
    const uri = typeof params.channel === 'string' ? params.channel : '';
    const channel = options.channels()[uri];
    if (channel === undefined) throw new RpcError(-32001, `No channel with operations at ${uri}`);
    const operationId = typeof params.operationId === 'string' ? params.operationId : '';
    const operation = channel.operations().find((one) => one.id === operationId);
    if (operation === undefined) {
      throw new RpcError(INVALID_PARAMS, `No operation called ${operationId} on ${uri}; one the list offers now can be run`);
    }
    // The gate admitted the command; the operation is checked here. No reader
    // is the root connection, or a host with no users directory.
    const grant = operation.grant as Grant;
    if (reader !== undefined && !reader.can(grant)) throw new RpcError(-32009, refusalReason(reader.id, grant), {});
    const target = targetOf(operation, params.target);
    if (target !== undefined && channel.offers !== undefined && !(await channel.offers(target, operationId, reader))) {
      throw new RpcError(INVALID_PARAMS, `${operationId} is not offered on ${target} now`);
    }
    const input = inputOf(operation, params.input, options.check);
    channel.begin(operationId, target);
    try {
      const answer = await channel.run(operation, target, input, reader, { client, ...(owner === undefined ? {} : { owner }) });
      channel.settle(operationId, target);
      return answer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      channel.settle(operationId, target, message);
      options.onProblem?.(`${operationId} on ${uri} failed: ${message}`);
      // With the channel's code and data when it chose them: a refusal a
      // client branches on is more than its message.
      const chosen = error as { code?: unknown; data?: unknown };
      if (typeof chosen.code === 'number') throw new RpcError(chosen.code, message, chosen.data);
      throw new RpcError(INTERNAL_ERROR, message);
    }
  },
});

/**
 * The plugin channels that offer operations, as `invokeOperation` reads them.
 *
 * Each is served at `<scheme>://`, the URI its snapshot is read at, with the
 * plugin's own operations side; a channel without one is not listed, so the
 * command refuses it as a channel with no operations.
 *
 * A plugin cannot take one of the daemon's own URIs: the fold already refuses a
 * channel on a scheme the daemon registered. The list is read at each call;
 * an entry that cannot be served is left out and said once through
 * `onProblem`, and a list that throws refuses the call naming the plugin, with
 * what it threw in `onProblem` alone. A `begin` or `settle` that throws or
 * rejects is a line too: the caller gets what `run` answered.
 */
export const pluginOperationChannels = (
  channels: Record<string, { by?: string; channel: PluginChannel }> | undefined,
  onProblem?: (message: string) => void,
): Record<string, OperationChannel> => {
  const served: Record<string, OperationChannel> = {};
  const said = new Set<string>();
  const say = (line: string): void => {
    if (said.has(line)) return;
    said.add(line);
    onProblem?.(line);
  };
  for (const [scheme, one] of Object.entries(channels ?? {})) {
    const side = one.channel.operations;
    if (side === undefined) continue;
    const uri = `${scheme}://`;
    const by = one.by ?? 'unknown';
    /** Tell the plugin of a call, where nothing it does reaches the caller. */
    const tell = (member: 'begin' | 'settle', call: () => unknown): void => {
      const failed = (error: unknown): void => {
        onProblem?.(`plugin ${by} failed in ${member} at ${uri}: ${reason(error)}`);
      };
      try { void Promise.resolve(call()).catch(failed); }
      catch (error) { failed(error); }
    };
    served[uri] = {
      uri,
      operations: () => {
        const { operations, problems, failed } = listedOperations(by, uri, () => side.operations());
        for (const problem of problems) say(problem);
        if (failed !== undefined) throw new RpcError(INTERNAL_ERROR, failed);
        return operations;
      },
      begin: (operationId, target) => { tell('begin', () => side.begin?.(operationId, target)); },
      settle: (operationId, target, error) => { tell('settle', () => side.settle?.(operationId, target, error)); },
      ...(side.offers === undefined ? {} : { offers: (target: string, operationId: string, reader?: Principal) => side.offers!(target, operationId, reader) }),
      run: (operation, target, input, reader, caller) => side.run(operation, target, input, reader, caller),
    };
  }
  return served;
};
