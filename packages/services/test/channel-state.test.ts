import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { servicesState } from '../src/channel.js';
import { listServices, type ComposeMachine } from '../src/compose.js';
import { SCHEDULED_FAILED_REF, watchAlerts } from '../src/watch.js';

/*
 * @dev/21's #39156 C handshake: the scheduled incident has to survive the AHP snapshot, not just the watcher. The ref
 * belongs on the job's own row (not the machine-level list), and the row's state has to carry the exit code and the
 * run's end time, so a completion can be measured rather than inferred from the absence of an alert.
 */

let dir: string;
afterEach(() => { if (dir !== undefined) rmSync(dir, { recursive: true, force: true }); });

const SCHEDULED = `processes:
  nightly:
    command: "sh -c 'exit 17'"
    schedule:
      cron: "0 3 * * *"
      timezone: America/Los_Angeles
`;

const machineFor = (text: string): ComposeMachine => {
  dir = mkdtempSync(join(tmpdir(), 'pc-channel-'));
  const file = join(dir, 'pc.yaml');
  writeFileSync(file, text);
  return { name: 'test-machine', configDir: dir, changeLog: join(dir, 'changes.jsonl'), backend: { kind: 'process-compose', files: [file], pc: { socket: join(dir, 'pc.sock') } } };
};

describe('the scheduled incident at the AHP snapshot (#39156 C, @dev/21)', () => {
  it('sits on the job row, with the exit code and the run end time beside the status', () => {
    const listing = listServices(machineFor(SCHEDULED));
    if (!listing.ok) throw new Error(listing.message);
    const running = [
      { name: 'nightly', status: 'Scheduled', exitCode: 17, restarts: 0, endedAt: '2026-11-28T03:00:02-08:00' },
      { name: 'web', status: 'Running', exitCode: 0, restarts: 0 },
    ];
    const alerts = watchAlerts('test-machine', listing, running, {});
    expect(alerts.map((one) => one.ref)).toEqual([`${SCHEDULED_FAILED_REF}nightly`]);
    const state = servicesState('test-machine', listing, running, alerts);
    const row = state.rows.find((one) => one.name === 'nightly')!;
    expect(row.alerts.map((one) => one.ref)).toEqual([`${SCHEDULED_FAILED_REF}nightly`]);
    expect(row.state).toEqual({ status: 'Scheduled', exitCode: 17, endedAt: '2026-11-28T03:00:02-08:00' });
    // Nothing about the job is left at the machine level.
    expect(state.alerts).toEqual([]);
    expect(state.rows.find((one) => one.name === 'web')!.state).toEqual({ status: 'Running', exitCode: 0 });
  });

  it('carries the run that cleared it, so the completion is measured from the row', () => {
    const listing = listServices(machineFor(SCHEDULED));
    if (!listing.ok) throw new Error(listing.message);
    const held: Record<string, { exit: number; restarts: number; at: string }> = {};
    const failed = [{ name: 'nightly', status: 'Scheduled', exitCode: 17, restarts: 0, endedAt: '2026-11-28T03:00:02-08:00' }];
    expect(watchAlerts('test-machine', listing, failed, held)).toHaveLength(1);
    const success = [{ name: 'nightly', status: 'Scheduled', exitCode: 0, restarts: 0, endedAt: '2026-11-29T03:00:01-08:00' }];
    const alerts = watchAlerts('test-machine', listing, success, held);
    expect(alerts).toEqual([]);
    const state = servicesState('test-machine', listing, success, alerts);
    const row = state.rows.find((one) => one.name === 'nightly')!;
    expect(row.alerts).toEqual([]);
    expect(row.state).toEqual({ status: 'Scheduled', exitCode: 0, endedAt: '2026-11-29T03:00:01-08:00' });
  });
});
