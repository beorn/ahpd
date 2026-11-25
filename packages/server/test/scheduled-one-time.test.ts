import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AutomationStore, Bag } from '@ahpd/sdk';
import { scheduledAutomations } from '../src/scheduled.js';

/*
 * The one-time trigger, as AHP 1.2.0 describes it and VS Code fires it: one
 * run at `runAt`, a passed time caught up once or skipped, and no edit once
 * it ran.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1007-L1024
 */

const ONE = 'ahp-automation:/one';

/** A timer that fires only when a case moves the clock. */
function clockwork(start = '2026-09-01T08:00:00Z') {
  let armed: { fire: () => void; ms: number } | undefined;
  let at = new Date(start);
  return {
    get armed() { return armed; },
    now: () => at,
    advance(to: string) {
      at = new Date(to);
      const held = armed;
      armed = undefined;
      held?.fire();
    },
    timer(fire: () => void, ms: number) {
      armed = { fire, ms };
      return { cancel: () => { armed = undefined; } };
    },
  };
}

/** A definition that runs once, at `runAt`. */
const once = (runAt: string, extra: Bag = {}): Bag => ({
  title: 'Once',
  enabled: true,
  message: { text: 'check the release' },
  session: { provider: 'echo' },
  triggers: [{ id: 'o1', kind: 'oneTime', runAt, ...extra }],
});

let dir: string;
let store: AutomationStore | undefined;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-once-')); });
afterEach(() => {
  store?.close?.();
  store = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** A store whose due runs are run, as the host runs them, and the origins they ran with. */
const running = (clock: ReturnType<typeof clockwork>) => {
  const made = scheduledAutomations({ dir: join(dir, 'automations'), state: join(dir, 'state.json'), now: clock.now, timer: clock.timer });
  const fired: Bag[] = [];
  made.onDue?.((event) => {
    fired.push(event.origin);
    void made.run(event.automation, event.origin, async () => 'ahp-session:/made');
  });
  return { made, fired };
};

const settle = async (): Promise<void> => { for (let at = 0; at < 5; at++) await new Promise((done) => { setImmediate(done); }); };

describe('a one-time trigger', () => {
  it('says its runAt is next, runs once there, and is then consumed with no update', async () => {
    const clock = clockwork();
    const { made, fired } = running(clock);
    store = made;
    made.create(ONE, once('2026-09-01T09:30:00Z'));
    expect(made.get(ONE)?.nextRunAt).toBe('2026-09-01T09:30:00.000Z');
    expect(made.get(ONE)?.operations).toContain('update');

    clock.advance('2026-09-01T09:30:00Z');
    await settle();
    expect(fired).toEqual([{ kind: 'trigger', triggerId: 'o1', scheduledFor: '2026-09-01T09:30:00.000Z' }]);
    const entry = made.get(ONE);
    expect(entry?.nextRunAt).toBeUndefined();
    expect(entry?.operations).toEqual(['remove', 'run']);
    expect((entry?.definition._meta as Bag | undefined)?.ahpd).toMatchObject({ oneTimeRun: expect.stringMatching(/^ahp-automation-run:\//) });
    expect(clock.armed).toBeUndefined();
  });

  it('keeps the trigger for a press of Run, which is not its run', async () => {
    const clock = clockwork();
    const { made, fired } = running(clock);
    store = made;
    made.create(ONE, once('2026-09-01T09:30:00Z'));
    await made.run(ONE, { kind: 'manual' }, async () => 'ahp-session:/pressed');
    expect(made.get(ONE)?.nextRunAt).toBe('2026-09-01T09:30:00.000Z');
    clock.advance('2026-09-01T09:30:00Z');
    await settle();
    expect(fired).toHaveLength(1);
  });

  it('runs a runAt gone by once, as a catch-up, and not at all with skip', async () => {
    const late = clockwork('2026-09-01T10:00:00Z');
    const first = running(late);
    first.made.create(ONE, once('2026-09-01T09:00:00Z'));
    late.advance('2026-09-01T10:00:00Z');
    await settle();
    expect(first.fired).toEqual([{ kind: 'trigger', triggerId: 'o1', scheduledFor: '2026-09-01T09:00:00.000Z', catchUp: true }]);
    first.made.close?.();
    rmSync(join(dir, 'automations'), { recursive: true, force: true });
    rmSync(join(dir, 'state.json'), { force: true });

    const skipped = clockwork('2026-09-01T10:00:00Z');
    const second = running(skipped);
    store = second.made;
    second.made.create(ONE, once('2026-09-01T09:00:00Z', { misfirePolicy: 'skip' }));
    expect(second.made.get(ONE)?.nextRunAt).toBeUndefined();
    expect(skipped.armed).toBeUndefined();
    expect(second.fired).toEqual([]);
  });

  it('keeps its consumed mark across a restart', async () => {
    const clock = clockwork();
    const first = running(clock);
    first.made.create(ONE, once('2026-09-01T09:30:00Z'));
    clock.advance('2026-09-01T09:30:00Z');
    await settle();
    first.made.close?.();

    const again = clockwork('2026-09-01T11:00:00Z');
    const second = running(again);
    store = second.made;
    await settle();
    expect(second.made.get(ONE)?.nextRunAt).toBeUndefined();
    expect(second.made.get(ONE)?.operations).toEqual(['remove', 'run']);
    expect(second.fired).toEqual([]);
  });
});
