/**
 * The previous slot of a five-field cron (#39156 C, catch-up).
 *
 * process-compose runs a scheduled entry itself and keeps no last-run time, so
 * a slot that passed while the daemon was down is invisible afterwards: the
 * entry is simply not running when the daemon comes back. Catching that up
 * needs one small answer - "when was the last slot at or before now" - which
 * this computes in a named zone and returns as an instant.
 *
 * Prior art. Cron itself never catches up: Vixie cron forgives every slot it
 * was not running for, which is why anacron exists - it records a timestamp per
 * job and runs a missed one on the next start. systemd's timer units carry the
 * same idea as `Persistent=true`, keeping the last trigger in a stamp file.
 * Neither primitive is available here: pointed at process-compose, the driver
 * writes entries into process-compose's own file, which has no `Persistent`
 * equivalent and whose scheduler answers nothing about history, so the time has
 * to be recomputed from the schedule. `previousSlot` is that computation and
 * nothing else; the driver compares its answer with a last-run time it persists
 * (`<configDir>/schedule.json`), the way anacron's timestamps work.
 *
 * The scan walks minute by minute backwards through the named zone, so a local
 * wall clock that skips or repeats an hour (DST) is answered by the zone data
 * rather than by arithmetic on offsets. The window is bounded: a schedule whose
 * last slot is more than eight days back is rare enough that reporting "cannot
 * tell" is better than scanning years of minutes, and a caller treats an
 * unreadable answer as "do not catch up" rather than as "nothing missed".
 */

const MINUTE_MS = 60 * 1000;
/** How far back the scan looks: a weekly schedule's slot is at most seven days away. */
const WINDOW_MS = 8 * 24 * 60 * MINUTE_MS;

/** One field of the five: the minutes (etc.) it allows, and whether it names them at all. */
interface Field {
  readonly values: ReadonlySet<number>;
  /** Cron's day rule: a field beginning with `*` does not constrain the day. */
  readonly restricted: boolean;
}

interface Fields {
  readonly minute: Field;
  readonly hour: Field;
  readonly dayOfMonth: Field;
  readonly month: Field;
  readonly dayOfWeek: Field;
}

/** What one instant reads as on the zone's wall clock. */
interface Local {
  readonly minute: number;
  readonly hour: number;
  readonly day: number;
  readonly month: number;
  readonly weekday: number;
}

/**
 * Read one field, or `undefined` when it is not something cron would accept.
 * Supports `*`, a number, `a-b`, and a `/step` on any of those, joined by commas.
 * `weekday` folds 7 onto 0, as cron allows Sunday to be either.
 */
function readField(text: string, min: number, max: number, weekday = false): Field | undefined {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const pieces = part.split('/');
    const [rangeText, stepText, extra] = pieces;
    if (extra !== undefined || rangeText === undefined || rangeText === '') return undefined;
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText)) return undefined;
      step = Number(stepText);
      if (step < 1) return undefined;
    }
    let low: number;
    let high: number;
    if (rangeText === '*') {
      low = min;
      high = max;
    } else {
      const range = /^(\d+)(?:-(\d+))?$/.exec(rangeText);
      if (range === null) return undefined;
      low = Number(range[1]);
      high = range[2] === undefined ? (stepText === undefined ? low : max) : Number(range[2]);
      if (high < low) return undefined;
    }
    // A range is checked before folding 7 to 0, so `5-7` still means Fri-Sun.
    if (low < min || high > max) return undefined;
    for (let value = low; value <= high; value += step) values.add(weekday && value === 7 ? 0 : value);
  }
  return { values, restricted: !text.startsWith('*') };
}

function readCron(cron: string): Fields | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;
  const [minuteText, hourText, dayText, monthText, weekdayText] = parts;
  if (minuteText === undefined || hourText === undefined || dayText === undefined || monthText === undefined || weekdayText === undefined) {
    return undefined;
  }
  const minute = readField(minuteText, 0, 59);
  const hour = readField(hourText, 0, 23);
  const dayOfMonth = readField(dayText, 1, 31);
  const month = readField(monthText, 1, 12);
  const dayOfWeek = readField(weekdayText, 0, 7, true);
  if (minute === undefined || hour === undefined || dayOfMonth === undefined || month === undefined || dayOfWeek === undefined) {
    return undefined;
  }
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

const WEEKDAYS: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** A formatter reading one zone's wall clock, or `undefined` when the zone is not one this runtime knows. */
function formatterFor(timezone: string | undefined): Intl.DateTimeFormat | undefined {
  const key = timezone ?? '';
  const known = formatters.get(key);
  if (known !== undefined) return known;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      ...(timezone === undefined ? {} : { timeZone: timezone }),
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(key, formatter);
    return formatter;
  } catch {
    return undefined;
  }
}

function localAt(formatter: Intl.DateTimeFormat, at: number): Local | undefined {
  let minute: number | undefined;
  let hour: number | undefined;
  let day: number | undefined;
  let month: number | undefined;
  let weekday: number | undefined;
  for (const part of formatter.formatToParts(new Date(at))) {
    switch (part.type) {
      case 'minute': minute = Number(part.value); break;
      case 'hour': hour = Number(part.value); break;
      case 'day': day = Number(part.value); break;
      case 'month': month = Number(part.value); break;
      case 'weekday': weekday = WEEKDAYS[part.value]; break;
      default: break;
    }
  }
  if (minute === undefined || hour === undefined || day === undefined || month === undefined || weekday === undefined) {
    return undefined;
  }
  return { minute, hour, day, month, weekday };
}

function matches(fields: Fields, local: Local): boolean {
  if (!fields.minute.values.has(local.minute)) return false;
  if (!fields.hour.values.has(local.hour)) return false;
  if (!fields.month.values.has(local.month)) return false;
  const byDay = fields.dayOfMonth.values.has(local.day);
  const byWeekday = fields.dayOfWeek.values.has(local.weekday);
  // Cron's day rule: when both day fields name something, either may match;
  // when one of them is `*`, the other decides on its own.
  if (fields.dayOfMonth.restricted && fields.dayOfWeek.restricted) return byDay || byWeekday;
  return byDay && byWeekday;
}

/**
 * The most recent minute at or before `now` that `cron` fires on, in `timezone`
 * (the host's own zone when it is not given), or `undefined` when the schedule
 * is not one this reads or its last slot is outside the bounded window.
 */
export function previousSlot(cron: string, now: Date, timezone?: string): Date | undefined {
  const fields = readCron(cron);
  if (fields === undefined) return undefined;
  const formatter = formatterFor(timezone);
  if (formatter === undefined) return undefined;
  const start = now.getTime();
  if (Number.isNaN(start)) return undefined;
  for (let at = Math.floor(start / MINUTE_MS) * MINUTE_MS, stop = at - WINDOW_MS; at >= stop; at -= MINUTE_MS) {
    const local = localAt(formatter, at);
    if (local !== undefined && matches(fields, local)) return new Date(at);
  }
  return undefined;
}
