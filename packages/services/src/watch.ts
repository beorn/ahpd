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
import type { Node } from 'yaml';
import { isMap, isScalar, Scalar } from 'yaml';
import type { Answer, Listing } from './compose.js';
import type { DriftAlert, DriftFacts } from './drift.js';

/** The ref prefix of the alert for a program process-compose stopped restarting. */
export const GAVE_UP_REF = 'services-gave-up:';
/** The ref prefix of the alert for a command YAML cut at a ` #`. */
export const CUT_COMMAND_REF = 'services-lint:';
/** How a read-only entry's reason begins when its command was cut; the plugin raises an alert for each. */
export const CUT_COMMAND_REASON = 'its command is unquoted and YAML reads';

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
 * as many restarts as `max_restarts` allows (0 is unlimited, so it never gives up).
 * A read-only entry has no record to read its limit from, so it is never judged.
 */
export function watchAlerts(machine: string, listing: Answer<Listing>, running: DriftFacts['running'] | undefined): DriftAlert[] {
  if (!listing.ok) return [];
  const out: DriftAlert[] = [];
  const held = typeof running === 'object' ? new Map(running.map((one) => [one.name, one])) : undefined;
  for (const record of [...listing.services].sort((a, b) => a.name.localeCompare(b.name))) {
    const now = held?.get(record.name);
    const most = record.restart?.max_restarts;
    if (now === undefined || most === undefined || most === 0) continue;
    if (record.restart?.policy !== 'always' && record.restart?.policy !== 'on_failure') continue;
    if (now.status !== 'Completed' || now.exitCode === undefined || now.exitCode === 0) continue;
    // #39156 acceptance C: a code the entry declares report-only is an answer, not a failure, so it takes no
    // incident path. Only a code it did not declare is treated as the program having failed.
    if (record.reports?.includes(now.exitCode) === true) continue;
    if (now.restarts === undefined || now.restarts < most) continue;
    out.push({
      level: 'error',
      ref: `${GAVE_UP_REF}${record.name}`,
      text: `process-compose on ${machine} gave up on ${record.name}: it exited ${now.exitCode} after ${now.restarts} restarts `
        + `(max_restarts ${most}) and will not be started again until someone starts it; ${ownerOf(record)}`,
    });
  }
  for (const one of [...listing.readOnly].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!one.reason.startsWith(CUT_COMMAND_REASON)) continue;
    out.push({ level: 'error', ref: `${CUT_COMMAND_REF}${one.name}`, text: `${one.name} on ${machine}: ${one.reason}` });
  }
  return out;
}
