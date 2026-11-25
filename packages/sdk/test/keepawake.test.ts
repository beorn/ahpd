import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeepAwake, KEEP_AWAKE_RELEASE_DELAY, keepAwakeModeOf } from '../src/host/keepawake.js';

/*
 * The host's hold on idle sleep, VS Code's `AgentHostKeepAwake`: held while a
 * chat works, let go 2 minutes after the last one stops.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostKeepAwake.ts
 */

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A policy over a key and a running flag the case moves, recording each hold. */
const policy = (mode: unknown = undefined) => {
  const holds: { allowOnBattery: boolean; released: boolean }[] = [];
  const state = { mode, running: false };
  const keep = createKeepAwake((allowOnBattery) => {
    const hold = { allowOnBattery, released: false };
    holds.push(hold);
    return { release: () => { hold.released = true; } };
  }, () => state.mode, () => state.running);
  return { holds, state, keep };
};

describe('the hold', () => {
  it('reads anything but never and always as whenPluggedIn', () => {
    expect(keepAwakeModeOf(undefined)).toBe('whenPluggedIn');
    expect(keepAwakeModeOf('never')).toBe('never');
    expect(keepAwakeModeOf('always')).toBe('always');
    expect(keepAwakeModeOf('sometimes')).toBe('whenPluggedIn');
  });

  it('holds once while a chat works, and lets go 2 minutes after the last stops', () => {
    const { holds, state, keep } = policy();
    keep.update();
    expect(holds).toEqual([]);
    state.running = true;
    keep.update();
    keep.update();
    expect(holds).toEqual([{ allowOnBattery: false, released: false }]);
    state.running = false;
    keep.update();
    vi.advanceTimersByTime(KEEP_AWAKE_RELEASE_DELAY - 1);
    expect(holds[0]?.released).toBe(false);
    vi.advanceTimersByTime(1);
    expect(holds[0]?.released).toBe(true);
  });

  it('keeps the hold through a pause shorter than the delay', () => {
    const { holds, state, keep } = policy();
    state.running = true;
    keep.update();
    state.running = false;
    keep.update();
    vi.advanceTimersByTime(60_000);
    state.running = true;
    keep.update();
    vi.advanceTimersByTime(KEEP_AWAKE_RELEASE_DELAY);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.released).toBe(false);
  });

  it('holds nothing at never, lets go at once when the key moves to it, and holds on battery at always', () => {
    const { holds, state, keep } = policy('never');
    state.running = true;
    keep.update();
    expect(holds).toEqual([]);
    state.mode = 'always';
    keep.update();
    expect(holds).toEqual([{ allowOnBattery: true, released: false }]);
    state.mode = 'never';
    keep.update();
    expect(holds[0]?.released).toBe(true);
    expect(holds).toHaveLength(1);
  });

  it('lets go at once when stopped, and does nothing without a helper', () => {
    const { holds, state, keep } = policy();
    state.running = true;
    keep.update();
    keep.stop();
    expect(holds[0]?.released).toBe(true);
    const none = createKeepAwake(undefined, () => 'always', () => true);
    expect(() => { none.update(); none.stop(); }).not.toThrow();
  });
});
