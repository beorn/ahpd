import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loggerOf } from '../src/log.js';
import type { LogLevel } from '../src/log.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { grantRefusals, REFUSAL_WINDOW_MS, REFUSAL_WINDOWS, REFUSAL_WINDOWS_PER_PRINCIPAL } from '../src/host/refusals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { LoaderContext } from '../src/types/plugin.js';

/*
 * A grant refusal is said in the host's own log, not only to the caller (@cto
 * ab54193c): one warn line per refusal, and per (principal, method) at most one
 * a minute after the first, with how many were not written.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-refusal-log-'));
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});
const REFUSED = /^grant refused: /;

/** A host with no users directory, `x-probe/restart` (grant probe:control), and the Hightea pipe as a plugin peer without it. */
async function hosting(clientId = 'hightea-pipe') {
  const lines: { line: string; level: LogLevel }[] = [];
  const probe = pluginHost('probe', context(), { grants: [] });
  probe.host.registerMethod('x-probe/restart', { grant: 'probe:control', describe: () => ({ title: 'restart' }), handle: async () => ({ ok: true }) });
  const pipe = pluginHost('hightea-pipe', context(), { grants: ['session:write', 'session:state', 'chat:turns'] });
  const { options } = foldHostOptions({
    path: DIR, agents: [{ ...echo({ path: DIR, pace: 0 }), provider: 'base', displayName: 'Base' }], sessions: memorySessions(),
    onEvent: (line: string, level: LogLevel) => { lines.push({ line, level }); },
  }, [probe.contribution, pipe.contribution]);
  const host = createHost(options);
  for (const one of options.pluginConnects ?? []) one.host = host;
  const peer = pipe.host.connect();
  await peer.request('initialize', { clientId, protocolVersions: ['0.9.0'] });
  const refused = () => lines.filter((one) => REFUSED.test(one.line));
  const ask = () => peer.request('x-probe/restart', {}).then(() => 'ADMITTED', (error: { code?: number }) => error.code);
  return { host, refused, ask };
}

it('a refused call writes exactly one warn line naming the principal, method, grant and connection', async () => {
  const { host, refused, ask } = await hosting();
  expect(await ask()).toBe(-32009);
  expect(refused()).toEqual([{
    line: 'grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control conn=hightea-pipe',
    level: 'warn',
  }]);
  await host.close();
  expect(refused()).toHaveLength(1);
});

it('100 refusals inside a minute write two lines: the first, and one saying 99 more were suppressed', async () => {
  const { host, refused, ask } = await hosting();
  for (let i = 0; i < 100; i += 1) expect(await ask()).toBe(-32009);
  expect(refused()).toHaveLength(1);
  // The host closing ends the minute, as the minute's own end would.
  await host.close();
  expect(refused().map((one) => one.line)).toEqual([
    'grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control conn=hightea-pipe',
    'grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control conn=hightea-pipe (99 more suppressed)',
  ]);
});

afterEach(() => { vi.useRealTimers(); });

it("the minute's end writes the suppressed count, each (principal, method) has its own minute, and a refusal after it is written at once", () => {
  vi.useFakeTimers();
  const lines: string[] = [];
  const refusals = grantRefusals(loggerOf((line: string) => { lines.push(line); }));
  const restart = { principal: 'plugin:hightea-pipe', method: 'x-probe/restart', needs: 'probe:control', conn: 'c1' };
  const list = { ...restart, method: 'x-probe/list', needs: 'probe:read' };
  for (let i = 0; i < 100; i += 1) refusals.refused(restart);
  refusals.refused(list);
  expect(lines).toHaveLength(2);
  vi.advanceTimersByTime(REFUSAL_WINDOW_MS);
  expect(lines).toEqual([
    'grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control conn=c1',
    'grant refused: principal=plugin:hightea-pipe method=x-probe/list needs=probe:read conn=c1',
    'grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control conn=c1 (99 more suppressed)',
  ]);
  refusals.refused(restart);
  expect(lines).toHaveLength(4);
  refusals.close();
  expect(lines).toHaveLength(4);
});

/*
 * The caller chooses the method, the action type and its client id (@cto
 * ae379641): no value can end the line or forge a field, and distinct methods
 * cannot write a line each or grow the windows without end.
 */
it('a client id carrying a newline and a forged field writes one line, with the newline, spaces and = escaped', async () => {
  const { host, refused, ask } = await hosting('x\ngrant refused: principal=root');
  expect(await ask()).toBe(-32009);
  await host.close();
  expect(refused()).toHaveLength(1);
  const [only] = refused();
  expect(only?.line.includes('\n')).toBe(false);
  expect(only?.line).toBe('grant refused: principal=plugin:hightea-pipe method=x-probe/restart needs=probe:control'
    + ' conn=x\\x0agrant\\x20refused:\\x20principal\\x3droot');
});

it('a value is cut at 200 characters', () => {
  const lines: string[] = [];
  const refusals = grantRefusals(loggerOf((line: string) => { lines.push(line); }));
  refusals.refused({ principal: 'plugin:p', method: 'm'.repeat(500), needs: 'g', conn: 'c' });
  refusals.close();
  expect(lines).toEqual([`grant refused: principal=plugin:p method=${'m'.repeat(200)} needs=g conn=c`]);
});

it('1,000 distinct methods from one principal write at most 22 lines in the minute, and the windows stay bounded', () => {
  vi.useFakeTimers();
  const lines: string[] = [];
  const refusals = grantRefusals(loggerOf((line: string) => { lines.push(line); }));
  for (let i = 0; i < 1000; i += 1) refusals.refused({ principal: 'plugin:pipe', method: `x-flood/${i}`, needs: 'flood:any', conn: 'c' });
  expect(refusals.open()).toBe(REFUSAL_WINDOWS_PER_PRINCIPAL + 1);
  expect(lines).toHaveLength(REFUSAL_WINDOWS_PER_PRINCIPAL + 1);
  expect(lines.at(-1)).toBe('grant refused: principal=plugin:pipe method=* needs=flood:any conn=c');
  vi.advanceTimersByTime(REFUSAL_WINDOW_MS);
  expect(lines).toHaveLength(REFUSAL_WINDOWS_PER_PRINCIPAL + 2);
  expect(lines.at(-1)).toBe('grant refused: principal=plugin:pipe method=* needs=flood:any conn=c (979 more suppressed)');
  expect(refusals.open()).toBe(0);
  // The minute over, a method is its own window again.
  refusals.refused({ principal: 'plugin:pipe', method: 'x-flood/0', needs: 'flood:any', conn: 'c' });
  expect(lines.at(-1)).toBe('grant refused: principal=plugin:pipe method=x-flood/0 needs=flood:any conn=c');
});

it('the host holds at most 1,000 windows, plus one method=* window per principal past it', () => {
  vi.useFakeTimers();
  const refusals = grantRefusals(loggerOf(() => {}));
  const principals = 60;
  for (let p = 0; p < principals; p += 1) {
    for (let i = 0; i < REFUSAL_WINDOWS_PER_PRINCIPAL; i += 1) refusals.refused({ principal: `user:${p}`, method: `m/${i}`, needs: 'g', conn: 'c' });
  }
  expect(refusals.open()).toBeGreaterThanOrEqual(REFUSAL_WINDOWS);
  expect(refusals.open()).toBeLessThanOrEqual(REFUSAL_WINDOWS + principals);
  refusals.close();
  expect(refusals.open()).toBe(0);
});
