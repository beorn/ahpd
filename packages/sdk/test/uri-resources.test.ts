import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ResourceProvider } from '../src/types/resources.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A host-owned URI scheme, beside files.
 *
 * A resource command is routed by the scheme in the URI: `file:` to the store
 * the host was given, the client scheme to the client it names, and a
 * registered scheme to its provider.
 *
 * What a provider leaves out is `-32601`, the same answer a read-only store's
 * missing write half gets, and a scheme nobody serves is told as one nothing
 * here serves.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-uri-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A read-only `computer:` provider: no list, no watch and no writes. */
const computer = (): ResourceProvider => ({
  read: async (uri) => ({ data: `status of ${uri}`, encoding: 'utf-8' }),
  resolve: async (uri) => ({
    uri,
    type: 'file',
    size: 3,
    mtime: new Date(0).toISOString(),
    ctime: new Date(0).toISOString(),
  }),
});

const host = (providers: Record<string, ResourceProvider> = { computer: computer() }) => createHost({
  path: root,
  agents: [echo({ path: root, pace: 0 })],
  resources: fileResources(),
  resourceProviders: providers,
});

async function open(one: ReturnType<typeof host>) {
  const client = one.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return client;
}

it('reads a file while a provider is registered, and reaches the provider by scheme', async () => {
  writeFileSync(join(root, 'a.txt'), 'on disk');
  const client = await open(host());

  // `file:` did not move: the daemon's own store answers it as it always did.
  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: `file://${root}/a.txt` },
  })).toMatchObject({ data: 'on disk' });

  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'computer://local/status' },
  })).toEqual({ data: 'status of computer://local/status', encoding: 'utf-8' });

  expect(await client.handle({
    method: 'resourceResolve', params: { channel: 'ahp-root://', uri: 'computer://local/status' },
  })).toMatchObject({ uri: 'computer://local/status', type: 'file' });
});

/*
 * An operation a provider left out, and a scheme nobody serves, are NotFound,
 * the code VS Code's host answers a resource it has no provider operation
 * for with, and never a permission code.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostResourceProviders.ts#L88-L95
 */
it('answers NotFound in VS Code\'s words for an operation the provider left out, as a read-only store does', async () => {
  const client = await open(host());
  await expect(client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://local' },
  })).rejects.toMatchObject({ code: -32008, message: 'Resource operation \'list\' is not supported for: computer://local' });
  await expect(client.handle({
    method: 'resourceWrite',
    params: { channel: 'ahp-root://', uri: 'computer://local/status', data: 'x', encoding: 'utf-8' },
  })).rejects.toMatchObject({ code: -32008, message: 'Resource operation \'write\' is not supported for: computer://local/status' });
});

it('answers a scheme nobody serves NotFound, not a permission code', async () => {
  const client = await open(host({}));
  const refused = await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'notes://local/x' },
  }).then(() => 'read', (error: { code: number; message: string }) => error);
  expect(refused).toMatchObject({ code: -32008 });
  expect((refused as { message: string }).message).toContain('nothing here serves notes:');
});

/*
 * A move is the source's store's to carry out, whatever the destination, as
 * VS Code's host hands it to the source's provider: the file store refuses a
 * destination it cannot write, in its own words, and the file stays.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostResourceProviders.ts#L68-L78
 */
it('hands a move whose two ends are different schemes to the source\'s store', async () => {
  writeFileSync(join(root, 'from.txt'), 'carried');
  const client = await open(host());
  await expect(client.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: `file://${root}/from.txt`, destination: 'computer://local/from.txt' },
  })).rejects.toMatchObject({ code: -32009, message: expect.stringContaining('computer://local/from.txt') });
  expect(existsSync(join(root, 'from.txt'))).toBe(true);
});

it('reads a provider\'s scheme from the provider, and a client\'s resource from the client under the client scheme', async () => {
  const answer = { data: 'from the client', encoding: 'utf-8' };
  const asked: string[] = [];
  const publisher: Peer = {
    send: () => {}, notify: () => {}, answered: () => {}, close: () => {},
    request: async (_method, params) => { asked.push(String((params as { uri?: unknown }).uri)); return answer; },
  };
  const served = host({ virtual: computer() });
  const publishing = served.accept(publisher);
  await publishing.handle({ method: 'initialize', params: { clientId: 'editor', protocolVersions: ['0.9.0'] } });
  const client = await open(served);

  // The provider's scheme is the provider's, whatever client its authority names.
  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://editor/notes.md' },
  })).toEqual({ data: 'status of virtual://editor/notes.md', encoding: 'utf-8' });
  expect(asked).toEqual([]);
  // And the client's own, under the client scheme.
  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'vscode-agent-client://editor/virtual/editor/notes.md' },
  })).toEqual(answer);
  expect(asked).toEqual(['virtual://editor/notes.md']);
});

/*
 * A byte range of a file, from AHP 1.1.0's `resourceRead`: the slice and the
 * file's `size`, a text slice that never ends inside a character, and a read
 * with no range answered whole and with no `size`. A scheme whose store reads
 * no ranges answers the whole resource.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.1.0/types/common/commands.ts#L866-L920
 */
const read = (client: Awaited<ReturnType<typeof open>>, uri: string, more: Record<string, unknown> = {}) =>
  client.handle({ method: 'resourceRead', params: { channel: 'ahp-root://', uri, ...more } });

it('reads a byte range of a text file and says the file\'s size', async () => {
  writeFileSync(join(root, 'a.txt'), 'hello world');
  const client = await open(host());
  expect(await read(client, `file://${root}/a.txt`, { position: 6, length: 3 }))
    .toEqual({ data: 'wor', encoding: 'utf-8', contentType: 'text/plain', size: 11 });
  expect(await read(client, `file://${root}/a.txt`, { position: 6 })).toMatchObject({ data: 'world', size: 11 });
  expect(await read(client, `file://${root}/a.txt`, { length: 5 })).toMatchObject({ data: 'hello', size: 11 });
});

it('reads a byte range of a binary file as base64', async () => {
  writeFileSync(join(root, 'b.bin'), Buffer.from([0, 1, 2, 3, 4, 5]));
  const client = await open(host());
  expect(await read(client, `file://${root}/b.bin`, { position: 0, length: 3 }))
    .toEqual({ data: Buffer.from([0, 1, 2]).toString('base64'), encoding: 'base64', size: 6 });
  expect(await read(client, `file://${root}/b.bin`, { position: 2, length: 2, encoding: 'base64' }))
    .toEqual({ data: Buffer.from([2, 3]).toString('base64'), encoding: 'base64', size: 6 });
});

it('answers nothing past the end, and the size', async () => {
  writeFileSync(join(root, 'a.txt'), 'abc');
  const client = await open(host());
  expect(await read(client, `file://${root}/a.txt`, { position: 10 })).toMatchObject({ data: '', size: 3 });
});

it('ends a text range before a character it would cut', async () => {
  // `é` is two bytes, so three bytes from the start hold `a` and all of `é`, and two hold only `a`.
  writeFileSync(join(root, 'u.txt'), 'aéb');
  const client = await open(host());
  expect(await read(client, `file://${root}/u.txt`, { length: 3 })).toMatchObject({ data: 'aé', encoding: 'utf-8', size: 4 });
  expect(await read(client, `file://${root}/u.txt`, { length: 2 })).toMatchObject({ data: 'a', encoding: 'utf-8', size: 4 });
});

it('answers a read with no range whole and with no size, and a store with no ranges whole', async () => {
  writeFileSync(join(root, 'a.txt'), 'abc');
  const client = await open(host());
  const whole = await read(client, `file://${root}/a.txt`) as Record<string, unknown>;
  expect(whole).toMatchObject({ data: 'abc' });
  expect(whole).not.toHaveProperty('size');
  expect(await read(client, 'computer://local/status', { position: 1, length: 2 }))
    .toEqual({ data: 'status of computer://local/status', encoding: 'utf-8' });
});

it('refuses a bound that is not a whole number of 0 or more', async () => {
  writeFileSync(join(root, 'a.txt'), 'abc');
  const client = await open(host());
  await expect(read(client, `file://${root}/a.txt`, { position: -1 })).rejects.toMatchObject({ code: -32602 });
  await expect(read(client, `file://${root}/a.txt`, { length: 1.5 })).rejects.toMatchObject({ code: -32602 });
});
