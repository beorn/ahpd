import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANNEL, OPERATION, READS_SCHEME, deploysChannel, deploysProvider, deploysState, logOf, refusalError, runOf } from '../src/index.js';
import type { ChannelContext, DeployLayout } from '../src/index.js';

const machine = () => mkdtempSync(join(tmpdir(), 'ahpd-deploy-channel-'));

const journalOf = (stateDir: string, service: string, lines: readonly Record<string, unknown>[]): DeployLayout => {
  const root = join(stateDir, 'deploy', service);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'deploy.log'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return { stateDir, service };
};

const context = (stateDir: string, services: readonly string[], deploy = async () => ({ ok: true })): ChannelContext => ({
  machine: 'alpha',
  services: () => services,
  layout: (service) => ({ stateDir, service }),
  state: () => deploysState('alpha', services, (service) => ({ stateDir, service })),
  deploy,
});

const reader = (grants: readonly string[]) => ({ id: 'person', can: (grant: string) => grants.includes(grant) });

describe('the deploy channel (#38276, @cto 2026-11-25)', () => {
  it('lists the one operation and one row per deploy the journal holds, newest first', () => {
    const stateDir = machine();
    journalOf(stateDir, 'web', [
      { at: '2026-11-25T01:00:00.000Z', event: 'started', deployId: 'one', to: 'abc' },
      { at: '2026-11-25T01:02:00.000Z', event: 'finished', deployId: 'one', to: 'abc', outcome: 'switched, checked' },
      { at: '2026-11-25T02:00:00.000Z', event: 'started', deployId: 'two', to: 'def' },
    ]);
    const channel = deploysChannel(context(stateDir, ['web']));
    const state = channel.snapshot(CHANNEL) as { runs: { deployId: string; state: string }[]; operations: { id: string }[] };
    expect(state.operations.map((one) => one.id)).toEqual(['deploy']);
    // One row per deploy, and the row says the last thing the journal said about it.
    expect(state.runs.map((one) => [one.deployId, one.state])).toEqual([['two', 'started'], ['one', 'finished']]);
  });

  it('shows the running deploy from its lock, ahead of the record', () => {
    const stateDir = machine();
    const layout = journalOf(stateDir, 'web', [{ at: '2026-11-25T01:00:00.000Z', event: 'finished', deployId: 'old' }]);
    writeFileSync(join(stateDir, 'deploy', 'web', 'deploy.lock'), JSON.stringify({ deployId: 'now', step: 'build', pid: 999_999, startedAt: '2026-11-25T03:00:00.000Z', from: 'old', to: 'new' }) + '\n');
    const state = deploysState('alpha', ['web'], () => layout);
    expect(state.runs[0]).toMatchObject({ service: 'web', deployId: 'now', state: 'running', step: 'build' });
  });

  it('answers a per-run URI with that run, and a made-up id with the reason, never an empty answer', () => {
    const stateDir = machine();
    journalOf(stateDir, 'web', [{ at: '2026-11-25T01:00:00.000Z', event: 'finished', deployId: 'one' }]);
    const channel = deploysChannel(context(stateDir, ['web']));
    expect(channel.snapshot(`${CHANNEL}one`)).toMatchObject({ deployId: 'one', state: 'finished' });
    expect(channel.snapshot(`${CHANNEL}missing`)).toMatchObject({ deployId: 'missing', error: expect.stringContaining('no deploy missing') });
    expect(runOf(CHANNEL)).toBeUndefined();
    expect(runOf(`${CHANNEL}one/log`)).toBeUndefined();
    expect(runOf(`${CHANNEL}one`)).toBe('one');
  });

  it('offers its one operation only on a service this machine runs, and refuses another id by name', async () => {
    const asked: Record<string, unknown>[] = [];
    const channel = deploysChannel(context(machine(), ['web'], async (input) => { asked.push(input); return { ok: true }; }));
    expect(channel.operations.operations()).toEqual([OPERATION]);
    expect(channel.operations.offers('web', 'deploy')).toBe(true);
    expect(channel.operations.offers('mailer', 'deploy')).toBe(false);
    expect(channel.operations.offers('web', 'remove')).toBe(false);
    await channel.operations.run(OPERATION as unknown as { id: string }, 'web', { version: 'main' }, undefined, { client: 'cli' });
    // #38549: the input is the service and the version; the declaration is the record's.
    expect(asked[0]).toMatchObject({ service: 'web', version: 'main' });
    await expect(channel.operations.run({ id: 'remove' }, 'web', {}, undefined, { client: 'cli' })).rejects.toThrow('No operation called remove');
  });

  it('reads one deploy\'s journal under deploy:read, and nobody else\'s without it', async () => {
    const stateDir = machine();
    journalOf(stateDir, 'web', [
      { at: '2026-11-25T01:00:00.000Z', event: 'started', deployId: 'one' },
      { at: '2026-11-25T01:01:00.000Z', event: 'finished', deployId: 'two' },
    ]);
    const provider = deploysProvider(context(stateDir, ['web']));
    const uri = `${READS_SCHEME}://one/log`;
    expect(logOf(uri)).toBe('one');
    expect(logOf(`${CHANNEL}one`)).toBeUndefined();
    await expect(provider.authorize(uri, reader([]))).resolves.toBe(false);
    await expect(provider.authorize(uri, undefined)).resolves.toBe(false);
    await expect(provider.authorize(uri, reader(['deploy:read']))).resolves.toBe(true);
    const read = await provider.read(uri, undefined, reader(['deploy:read']));
    expect(read.contentType).toBe('application/x-ndjson');
    expect(read.data).toContain('"deployId":"one"');
    // The other deploy's lines are not in this deploy's log.
    expect(read.data).not.toContain('"deployId":"two"');
    await expect(provider.read(`${READS_SCHEME}://missing/log`)).rejects.toThrow('no deploy missing');
  });

  it('answers a refusal as an RpcError that keeps its own code', () => {
    expect(refusalError({ code: 'RUNNING', message: 'a deploy is running' })).toMatchObject({ name: 'RpcError', code: -32602, data: { code: 'RUNNING' } });
    expect(refusalError({ code: 'DRIVER_FAILED', message: 'it stopped' })).toMatchObject({ code: -32603 });
  });
});
