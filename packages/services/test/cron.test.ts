import { describe, expect, it } from 'vitest';
import { previousSlot } from '../src/cron.js';

/*
 * #39156 acceptance C, catch-up: process-compose keeps no last-run time, so a slot missed while the daemon was down
 * has to be computed. The evaluator is the smallest thing that can answer "when was the last slot at or before now",
 * in a named zone, and it refuses what it cannot read instead of guessing.
 */

describe('the previous slot of a five-field cron (#39156 C catch-up)', () => {
  it('answers the most recent minute a "every N minutes" schedule fired', () => {
    const slot = previousSlot('*/15 * * * *', new Date('2026-11-28T04:37:00Z'));
    expect(slot?.toISOString()).toBe('2026-11-28T04:30:00.000Z');
  });

  it('answers a fixed daily slot in the zone it names, not in UTC', () => {
    // 04:10 PST on Nov 28 is 12:10Z; the 02:00 PST slot is 10:00Z.
    const slot = previousSlot('0 2 * * *', new Date('2026-11-28T12:10:00Z'), 'America/Los_Angeles');
    expect(slot?.toISOString()).toBe('2026-11-28T10:00:00.000Z');
    const before = previousSlot('0 2 * * *', new Date('2026-11-28T09:59:00Z'), 'America/Los_Angeles');
    expect(before?.toISOString()).toBe('2026-11-27T10:00:00.000Z');
  });

  it('answers the slot itself when now is exactly on it', () => {
    expect(previousSlot('0 2 * * *', new Date('2026-11-28T10:00:00Z'), 'America/Los_Angeles')?.toISOString())
      .toBe('2026-11-28T10:00:00.000Z');
  });

  it('reads ranges, steps and lists', () => {
    expect(previousSlot('10-20/5 * * * *', new Date('2026-11-28T04:21:00Z'))?.toISOString()).toBe('2026-11-28T04:20:00.000Z');
    // A step inside a range only visits the range: 5 and 10, not 40.
    expect(previousSlot('5-10/5 * * * *', new Date('2026-11-28T04:41:00Z'))?.toISOString()).toBe('2026-11-28T04:10:00.000Z');
    expect(previousSlot('5,25,45 * * * *', new Date('2026-11-28T04:41:00Z'))?.toISOString()).toBe('2026-11-28T04:25:00.000Z');
  });

  it('reads the weekday field', () => {
    expect(previousSlot('0 9 * * 1', new Date('2026-11-28T12:00:00Z'), 'UTC')?.toISOString()).toBe('2026-11-23T09:00:00.000Z');
    // Sunday is both 0 and 7.
    expect(previousSlot('0 9 * * 7', new Date('2026-11-28T12:00:00Z'), 'UTC')?.toISOString()).toBe('2026-11-22T09:00:00.000Z');
  });

  it('takes either day field when both name one', () => {
    // The 1st of the month, or any Monday: whichever is later than the other.
    expect(previousSlot('0 9 26 * 1', new Date('2026-11-28T12:00:00Z'), 'UTC')?.toISOString()).toBe('2026-11-26T09:00:00.000Z');
  });

  it('refuses a schedule it cannot read', () => {
    expect(previousSlot('not a cron', new Date('2026-11-28T04:37:00Z'))).toBeUndefined();
    expect(previousSlot('61 * * * *', new Date('2026-11-28T04:37:00Z'))).toBeUndefined();
    expect(previousSlot('* * * *', new Date('2026-11-28T04:37:00Z'))).toBeUndefined();
    expect(previousSlot('0 2 * * *', new Date('2026-11-28T04:37:00Z'), 'Not/AZone')).toBeUndefined();
  });
});
