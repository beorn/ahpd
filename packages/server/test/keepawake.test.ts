import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdIdleSleep, isOnBatteryPowerFromLinuxSupplies, oncePerProcess } from '../src/keepawake.js';
import type { PowerBackend } from '../src/keepawake.js';
import type { ChildProcess } from 'node:child_process';

/*
 * The daemon's idle sleep helper, VS Code's `AgentHostPowerSaveBlocker`, with
 * a stand-in helper process.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostPowerSaveBlocker.ts
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A helper process that records its input's end and its kill. */
const helper = () => {
  const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean; ended: boolean; killed_: boolean };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.ended = false;
  child.killed_ = false;
  child.stdin.on('finish', () => { child.ended = true; });
  child.kill = () => { child.killed_ = true; return true; };
  return child;
};

const backend = (onBattery: () => Promise<boolean>, started: ReturnType<typeof helper>[], kill = false): PowerBackend => ({
  start: () => { const one = helper(); started.push(one); return one as unknown as ChildProcess; },
  isOnBatteryPower: onBattery,
  killOnDispose: kill,
});

const log = () => {
  const warned: string[] = [];
  return { warned, log: { warn: (line: string) => { warned.push(line); }, debug: () => {} } };
};

describe('the idle sleep helper', () => {
  it('starts one helper on mains power, and ends its input at release', async () => {
    const started: ReturnType<typeof helper>[] = [];
    const { log: said } = log();
    const hold = holdIdleSleep(false, said, backend(async () => false, started));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(started).toHaveLength(1);
    hold.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started[0]?.ended).toBe(true);
    expect(started[0]?.killed_).toBe(false);
  });

  it('starts none on battery unless allowed, and kills a helper that ignores its input', async () => {
    const started: ReturnType<typeof helper>[] = [];
    const { log: said } = log();
    holdIdleSleep(false, said, backend(async () => true, started)).release();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(0);
    const always = holdIdleSleep(true, said, backend(async () => true, started, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);
    always.release();
    expect(started[0]?.killed_).toBe(true);
  });

  it('logs a failing helper once, and goes on', async () => {
    const started: ReturnType<typeof helper>[] = [];
    const { log: said, warned } = log();
    const hold = holdIdleSleep(false, said, backend(async () => { throw new Error('Power source is unknown'); }, started));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(started).toHaveLength(0);
    expect(warned).toEqual(['keep-awake: cannot inhibit idle sleep on this host: Power source is unknown']);
    hold.release();
  });

  it('starts the helper again after it exits, while the hold is taken', async () => {
    const started: ReturnType<typeof helper>[] = [];
    const { log: said, warned } = log();
    const hold = holdIdleSleep(false, said, backend(async () => false, started));
    await vi.advanceTimersByTimeAsync(0);
    started[0]?.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(started).toHaveLength(2);
    expect(warned).toHaveLength(1);
    hold.release();
  });
});

describe('the daemon\'s log of the helper', () => {
  it('says each kind of failure once for the life of the daemon', async () => {
    const { log: said, warned } = log();
    const once = oncePerProcess(said);
    for (let at = 0; at < 3; at++) {
      const hold = holdIdleSleep(false, once, backend(async () => { throw new Error('Power source is unknown'); }, []));
      await vi.advanceTimersByTimeAsync(0);
      hold.release();
    }
    expect(warned).toEqual(['keep-awake: cannot inhibit idle sleep on this host: Power source is unknown']);
  });
});

describe('the Linux power source', () => {
  it('reads mains online as plugged in, an offline line or a discharging battery as battery, and nothing as unknown', () => {
    expect(isOnBatteryPowerFromLinuxSupplies([{ type: 'Mains', online: '1' }, { type: 'Battery', status: 'Discharging' }])).toBe(false);
    expect(isOnBatteryPowerFromLinuxSupplies([{ type: 'Mains', online: '0' }])).toBe(true);
    expect(isOnBatteryPowerFromLinuxSupplies([{ type: 'Battery', status: 'Discharging' }])).toBe(true);
    expect(() => isOnBatteryPowerFromLinuxSupplies([{ type: 'Battery', scope: 'Device', status: 'Discharging' }])).toThrow('Power source is unknown');
    expect(() => isOnBatteryPowerFromLinuxSupplies([])).toThrow('Power source is unknown');
  });
});
