/**
 * Two things process-compose does without a word, said as alerts (@cto 8f8fafce,
 * #38120 supervisor ruling, conditions 2 and 5).
 *
 * - **A program it gave up on.** With `availability.max_restarts` set, a program
 *   that keeps failing is restarted that many times and then left `Completed`
 *   with its non-zero exit code. process-compose itself carries on, so nothing
 *   above it (systemd, launchd) sees a failure. The services driver reads the
 *   process list on every drift check, so it is the one owner of this alert: no
 *   outside watcher, and no `exit_on_end`.
 * - **A command YAML cut short.** In a plain (unquoted) YAML scalar, ` #` starts
 *   a comment, so `command: run --flag # note` runs `run --flag` and
 *   `command: echo a #b` runs `echo`. Nothing says so: the file is valid YAML and
 *   process-compose runs what is left. The driver refuses to edit such an entry
 *   (it is read-only, with the reason) and raises an alert until it is quoted.
 *
 * Both are pure functions of what the driver already read; the plugin raises and
 * clears them by `ref` with the drift alerts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Node } from 'yaml';
import { isMap, isScalar, Scalar } from 'yaml';
import type { Answer, Listing } from './compose.js';
import type { DriftAlert, DriftFacts } from './drift.js';

/** The ref prefix of the alert for a program process-compose stopped restarting. */
export const GAVE_UP_REF = 'services-gave-up:';
/** The ref prefix of the alert for a scheduled job whose last run exited nonzero (@cto 6ea4f263). */
export const SCHEDULED_FAILED_REF = 'scheduled-run-failed:';
/** The ref prefix of the alert for a command YAML cut at a ` #`. */
export const CUT_COMMAND_REF = 'services-lint:';
/** How a read-only entry's reason begins when its command was cut; the plugin raises an alert for each. */
export const CUT_COMMAND_REASON = 'its command is unquoted and YAML reads';

/**
 * The last terminal outcome a service was left in (#39156 C, @dev/21's measured replay).
 *
 * process-compose answers a re-run in flight with `Running` and a zero `exit_code`, so judging the alert from the
 * current row alone made a gave-up program read as recovered the moment it was started again — a bare zero while
 * running cannot clear a failure. The driver therefore keeps the terminal exit of the run that failed and clears it
 * only on a later *terminal* success (exit 0, or a code the entry declares report-only).
 */
export interface TerminalFailure {
  readonly exit: number;
  readonly restarts: number;
  readonly at: string;
}

/**
 * What process-compose runs of a `command` YAML cut at a ` #`, or nothing when it
 * was not cut. Cut means: a plain scalar followed, on its own line, by a comment.
 * A quoted or block scalar keeps its `#`, and a comment on another line cuts nothing.
 */
export function cutCommand(entry: unknown, text: string): string | undefined {
  if (!isMap(entry)) return undefined;
  const command = entry.get('command', true) as Node | undefined;
  if (!isScalar(command) || command.type !== Scalar.PLAIN || command.range === undefined || command.range === null) return undefined;
  const end = command.range[1];
  const line = text.slice(end, text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end));
  return line.includes('#') ? String(command.value) : undefined;
}

/** The read-only reason for an entry whose command was cut. */
export const cutReason = (kept: string): string =>
  `${CUT_COMMAND_REASON} the " #" in it as a comment, so process-compose runs only ${JSON.stringify(kept)}; quote the whole command`;

/** Who put a service on the machine, as the alert says it. */
const ownerOf = (record: Listing['services'][number]): string =>
  record.source === undefined
    ? 'no x-hh-source names who put it here, so it is the machine\'s own person\'s'
    : `its owner is ${record.source.kind} ${record.source.id} (x-hh-source)`;

/**
 * Every alert the listing and the process list answer together, in a stable order:
 * one per program process-compose gave up on, and one per command YAML cut short.
 *
 * Gave up means `Completed`, a non-zero exit its `x-hh-reports` does not declare, a restart policy that restarts, and
 * as many restarts as `max_restarts` allows (0 is unlimited, so it never gives up). The failure is remembered in
 * `held` while the service runs again, because process-compose answers a re-run in flight with `Running` and exit 0;
 * it is cleared only by a later terminal success. A read-only entry has no record to read its limit from, so it is
 * never judged.
 */
export function watchAlerts(
  machine: string,
  listing: Answer<Listing>,
  running: DriftFacts['running'] | undefined,
  held: Record<string, TerminalFailure> = {},
  now: Date = new Date(),
): DriftAlert[] {
  if (!listing.ok) return [];
  const out: DriftAlert[] = [];
  const rows = typeof running === 'object' ? new Map(running.map((one) => [one.name, one])) : undefined;
  for (const record of [...listing.services].sort((a, b) => a.name.localeCompare(b.name))) {
    const most = record.restart?.max_restarts;
    const eligible = most !== undefined && most !== 0
      && (record.restart?.policy === 'always' || record.restart?.policy === 'on_failure');
    const row = rows?.get(record.name);
    if (record.schedule !== undefined) {
      // A scheduled job is a different fact from a service whose retries ran out (@cto 6ea4f263). Its row comes back as
      // `Scheduled` (or `Completed`) holding the last run's exit code and `process_end_time`, so a nonzero exit is a
      // failed run: raised per job, quiet for a code the entry declares report-only, kept while a re-run is in flight,
      // and cleared only by a later observed success. The same ref for the job updates on a repeat failure.
      if (rows !== undefined && row === undefined) { delete held[record.name]; continue; }
      if (row !== undefined && row.endedAt !== undefined && row.endedAt !== '' && row.exitCode !== undefined
        && (row.status === 'Completed' || row.status === 'Scheduled')) {
        if (row.exitCode === 0 || record.reports?.includes(row.exitCode) === true) { delete held[record.name]; continue; }
        held[record.name] = { exit: row.exitCode, restarts: row.restarts ?? 0, at: row.endedAt };
      }
      const ran = held[record.name];
      if (ran === undefined) continue;
      out.push({
        level: 'error',
        ref: `${SCHEDULED_FAILED_REF}${record.name}`,
        text: `scheduled job ${record.name} on ${machine}: its last run exited ${ran.exit} at ${ran.at}. This is a failed `
          + `scheduled run, not a service whose retries ran out, so the next slot will run it again. Its log is that `
          + `run\'s own output, read with the driver\'s logs read for ${record.name} (process-compose keeps it in `
          + `memory, so there is no path to name); ${ownerOf(record)}`,
      });
      continue;
    }
    if (!eligible) { delete held[record.name]; continue; }
    // A readable process list that holds no row for this service means it is gone; an unreadable one means nothing was
    // answered, and silence is never read as success: what is held stays held, and drift says the machine is unreadable.
    if (rows !== undefined && row === undefined) { delete held[record.name]; continue; }
    if (row !== undefined && row.status === 'Completed' && row.exitCode !== undefined) {
      // #39156 acceptance C: a code the entry declares report-only is an answer, not a failure, and exit 0 is the
      // success that ends a held failure. A failure below the restart limit is not terminal yet.
      if (row.exitCode === 0 || record.reports?.includes(row.exitCode) === true) { delete held[record.name]; continue; }
      if (row.restarts !== undefined && row.restarts >= most) {
        held[record.name] = { exit: row.exitCode, restarts: row.restarts, at: now.toISOString() };
      }
    }
    const failure = held[record.name];
    if (failure === undefined) continue;
    out.push({
      level: 'error',
      ref: `${GAVE_UP_REF}${record.name}`,
      text: `process-compose on ${machine} gave up on ${record.name}: it exited ${failure.exit} after ${failure.restarts} restarts `
        + `(max_restarts ${most}) and will not be started again until someone starts it; ${ownerOf(record)}`,
    });
  }
  for (const one of [...listing.readOnly].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!one.reason.startsWith(CUT_COMMAND_REASON)) continue;
    out.push({ level: 'error', ref: `${CUT_COMMAND_REF}${one.name}`, text: `${one.name} on ${machine}: ${one.reason}` });
  }
  return out;
}

/** The last terminal failures per service, read from the machine's outcomes file; an unreadable file reads as none. */
export function readOutcomes(file: string): Record<string, TerminalFailure> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, TerminalFailure> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue;
      const { exit, restarts, at } = value as Record<string, unknown>;
      if (typeof exit === 'number' && typeof restarts === 'number' && typeof at === 'string') {
        out[name] = { exit, restarts, at };
      }
    }
    return out;
  }
  catch {
    return {};
  }
}

/** Write the held failures back; 0600, because the file is the machine's own record of what failed. */
export function writeOutcomes(file: string, held: Record<string, TerminalFailure>): void {
  writeFileSync(file, `${JSON.stringify(held, null, 2)}\n`, { mode: 0o600 });
}
