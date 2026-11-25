import { RpcError, recordsChannel } from '@ahpd/sdk';
import { shownOf } from './provider.js';
import type { DeviceStore, PushProvider } from './provider.js';
import type { PluginMethod, RecordsChannel } from '@ahpd/sdk';

/** The channel's scheme. */
export const DEVICES_SCHEME = 'x-ahpd-push';

/** The one URI the channel answers on. */
export const DEVICES = `${DEVICES_SCHEME}://`;

/** The command that registers a device, or registers it again. */
export const PUT = 'x-ahpd/push/put';

/** The command that takes a device out. */
export const REMOVE = 'x-ahpd/push/remove';

/**
 * The `x-ahpd-push://` channel: the caller's own devices, kept current.
 *
 * A subscribe answers `{ records }`, each entry `{ id, record }` with the
 * record a read of `push://devices/<id>` answers: no token, no endpoint and no
 * keys. `added`, `changed` and `removed` follow it, as every records channel
 * sends them.
 *
 * Every reader sees only the devices registered by them, a holder of
 * `push:read` too: a device says which sessions its person hears about, and
 * that is nobody else's to list. Every signed-in person may subscribe with no
 * grant, as a person reads their own `user://` record, and a person with no
 * device is answered an empty list rather than refused.
 */
export const devicesChannel = (store: DeviceStore, onProblem?: (line: string) => void): RecordsChannel => {
  const channel = recordsChannel(DEVICES_SCHEME, {
    ids: async () => store.ids(),
    find: async (id) => {
      const device = store.get(id);
      return device === undefined ? undefined : shownOf(device);
    },
  }, {
    grant: 'push:read',
    mayRead: (id, reader) => store.get(id)?.owner === `user:${reader.id}`,
    mayReadEveryReader: true,
    describe: () => ({ title: 'Push devices', description: 'The devices you get notifications on.' }),
    ...(onProblem === undefined ? {} : { onProblem }),
  });
  return { ...channel, channel: { ...channel.channel, authorize: async (uri) => uri === DEVICES } };
};

/** A string param that names one device, or a refusal saying what the command needs. */
const idParam = (command: string, params: Record<string, unknown>): string => {
  const id = params.id;
  // An id a URI could not name is refused, so a device registered by command is one `push://devices/<id>` reads back.
  if (typeof id !== 'string' || id === '' || /[/?]/.test(id)) {
    throw new RpcError(-32602, `${command} needs id, the device's install id, with no / or ?`);
  }
  return id;
};

/**
 * The `x-ahpd/push/*` commands over this provider, by name.
 *
 * - `put` `{ id, record, createOnly?, ifMatch? }` registers `push://devices/<id>`.
 * - `remove` `{ id }` takes it out.
 *
 * Each runs the provider's own `write` or `delete`, whose rules are the
 * plugin's: a device is registered by the person on the connection, and another
 * person's is refused. `put` needs `push:put` and `remove` needs `push:delete`.
 * Both answer `{}` once `refresh` has sent the change.
 */
export const pushMethods = (provider: Pick<PushProvider, 'write' | 'delete'>, refresh: () => Promise<void>): Record<string, PluginMethod> => ({
  [PUT]: {
    grant: 'push:put',
    describe: () => ({ title: 'Register a device', description: 'Registers one device for notifications.' }),
    handle: async (params, reader, client, owner) => {
      const id = idParam(PUT, params);
      const record = params.record;
      if (typeof record !== 'object' || record === null || Array.isArray(record)) {
        throw new RpcError(-32602, 'A device is registered from a JSON object, and that body is not one');
      }
      const createOnly = params.createOnly;
      if (createOnly !== undefined && typeof createOnly !== 'boolean') throw new RpcError(-32602, `${PUT} takes createOnly as true or false`);
      const ifMatch = params.ifMatch;
      if (ifMatch !== undefined && typeof ifMatch !== 'string') throw new RpcError(-32602, `${PUT} takes ifMatch as a string`);
      await provider.write(`push://devices/${id}`, {
        data: JSON.stringify(record),
        encoding: 'utf-8',
        ...(createOnly === true ? { createOnly } : {}),
        ...(ifMatch === undefined ? {} : { ifMatch }),
      }, owner, client, reader);
      await refresh();
      return {};
    },
  },
  [REMOVE]: {
    grant: 'push:delete',
    describe: () => ({ title: 'Remove a device', description: 'Stops notifications to one device.' }),
    handle: async (params, reader, _client, owner) => {
      await provider.delete(`push://devices/${idParam(REMOVE, params)}`, false, owner, reader);
      await refresh();
      return {};
    },
  },
});
