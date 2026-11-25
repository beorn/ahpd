import { RpcError } from '@ahpd/sdk';
import type { PluginMethod } from '@ahpd/sdk';
import type { BotProvider } from './provider.js';

/** The command that makes or edits a bot. */
export const PUT = 'x-ahpd/bots/put';

/** The command that deletes a bot. */
export const REMOVE = 'x-ahpd/bots/remove';

/** A string param that names one bot, or a refusal saying what the command needs. */
const idParam = (command: string, params: Record<string, unknown>): string => {
  const id = params.id;
  // An id a URI could not name is refused, so a bot made by command is one `bot://<id>` reads back.
  if (typeof id !== 'string' || id === '' || /[/?]/.test(id)) {
    throw new RpcError(-32602, `${command} needs id, the bot's id, with no / or ?`);
  }
  return id;
};

/** An optional boolean param, or a refusal naming it. */
const flagParam = (command: string, params: Record<string, unknown>, name: string): boolean | undefined => {
  const value = params[name];
  if (value !== undefined && typeof value !== 'boolean') throw new RpcError(-32602, `${command} takes ${name} as true or false`);
  return value;
};

/**
 * The `x-ahpd/bots/*` commands over this provider, by name.
 *
 * - `put` `{ id, record, createOnly?, ifMatch? }` makes or edits `bot://<id>`.
 *   `ifMatch` is the `updatedAt` the caller last read.
 * - `remove` `{ id }` deletes it.
 *
 * Each runs the provider's own `write` or `delete`, whose rules are the
 * plugin's, and the catalogue hears both. `put` needs `bot:put` and `remove`
 * needs `bot:delete`. Both answer `{}`.
 */
export const botMethods = (provider: Pick<BotProvider, 'write' | 'delete'>): Record<string, PluginMethod> => ({
  [PUT]: {
    grant: 'bot:put',
    describe: () => ({ title: 'Put a bot', description: 'Makes or edits one bot.' }),
    handle: async (params, reader, client, owner) => {
      const id = idParam(PUT, params);
      const record = params.record;
      if (typeof record !== 'object' || record === null || Array.isArray(record)) {
        throw new RpcError(-32602, 'A bot is made from a JSON object, and that body is not one');
      }
      const createOnly = flagParam(PUT, params, 'createOnly');
      const ifMatch = params.ifMatch;
      if (ifMatch !== undefined && typeof ifMatch !== 'string') throw new RpcError(-32602, `${PUT} takes ifMatch as a string`);
      await provider.write(`bot://${id}`, {
        data: JSON.stringify(record),
        encoding: 'utf-8',
        ...(createOnly === true ? { createOnly } : {}),
        ...(ifMatch === undefined ? {} : { ifMatch }),
      }, owner, client, reader);
      return {};
    },
  },
  [REMOVE]: {
    grant: 'bot:delete',
    describe: () => ({ title: 'Remove a bot', description: 'Deletes one bot.' }),
    handle: async (params, reader, _client, owner) => {
      await provider.delete(`bot://${idParam(REMOVE, params)}`, false, owner, reader);
      return {};
    },
  },
});
