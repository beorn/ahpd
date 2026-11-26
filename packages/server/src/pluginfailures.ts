/**
 * What a start could not load, kept beside the configuration.
 *
 * A plugin that fails to resolve, import or apply is reported and skipped, so
 * the daemon comes up with part of its work absent. One line says so - in the
 * log, and in the announcement a foreground daemon or `ahpd start` prints - but
 * a host a service manager runs writes that announcement where nobody reads
 * it, and `ahpd doctor` describes the plugins the configuration names without
 * knowing which of them applied. That is how a host comes up "healthy" with a
 * dead plugin: every surface says up, and only a line in a log says the board
 * push never connected.
 *
 * This file is that fact kept after the start: the error each plugin's row
 * carried when it tried. The next fold that loads every plugin removes it, so
 * its presence always describes the fold now running. `doctor` reads it so the
 * skip is not a log line, and a supervisor reads it so it can page.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reason } from '@ahpd/sdk';
import type { Alert } from '@ahpd/sdk';
import { redactSecretsInText } from './redaction.js';

/** The file, beside `daemon.json` in the configuration directory. */
export const PLUGIN_FAILURES_FILE = 'plugin-failures.json';

/** One plugin that did not load, and the line its row says why. */
export interface PluginFailure {
  /** The plugin's id, as the load named it. */
  readonly plugin: string;
  /** The last line of its load: why it did not load. */
  readonly line: string;
}

/** The marker a value this file will not repeat is replaced by, as the wire uses it. */
const REDACTED = '<redacted>';

/** A key that names a credential, however a person spelled it in their configuration. */
const CREDENTIAL_KEY = String.raw`[A-Za-z0-9_.-]*(?:token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*`;

/** `<key>=<value>` or `<key>: <value>` where the key names a credential, also quoted or in JSON. */
const KEYED_CREDENTIAL = new RegExp(String.raw`(${CREDENTIAL_KEY}\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;)\]}]*)`, 'gi');

/** `Bearer <value>`, as an authorization header a plugin quoted reaches a line. */
const BEARER_CREDENTIAL = /\b(Bearer\s+)\S+/gi;

/**
 * A line with anything that looks like a credential taken out of it.
 *
 * A plugin's error is free text and may quote a token it was given, and this
 * file is read by `ahpd doctor`, printed by `ahpd status`, and folded into a
 * page a supervisor may broadcast. None of those is a place for a credential,
 * so a keyed token, a bearer value and a URL that carries a secret are removed
 * wherever a line holds one. What a plugin's own schema marks `writeOnly` or
 * `secret` is taken out where the loader still has the schema (in `plugins.ts`,
 * `withoutMarkedSecrets`); this is the part every record and every reader can
 * do without it, the record a build before this one wrote included.
 */
export const redactFailurePatterns = (line: string): string => redactSecretsInText(line)
  .replace(KEYED_CREDENTIAL, `$1${REDACTED}`)
  .replace(BEARER_CREDENTIAL, `$1${REDACTED}`);

/** What one start could not load. */
export interface PluginFailures {
  /** When the fold that found them was read, from the writer's clock. */
  readonly at: string;
  /** One entry per plugin that did not load, sorted by id. */
  readonly failures: readonly PluginFailure[];
}

/** Where the record of one configuration directory lives. */
export const pluginFailuresPath = (configDir: string): string => join(configDir, PLUGIN_FAILURES_FILE);

/**
 * The failures an applied fold carries: one per plugin whose row holds an
 * error, with the last error that row holds as its line.
 *
 * The loader gives a plugin that did not load an `error` alert and gives the
 * ones it did load only warnings, so the level is the whole test. A reload
 * replaces the row's alerts, which is why the current fold's are read here
 * rather than any a plugin raised earlier.
 */
export function pluginFailuresOf(alerts: Readonly<Record<string, readonly Alert[]>>): PluginFailure[] {
  const found: PluginFailure[] = [];
  for (const [plugin, list] of Object.entries(alerts)) {
    const errors = list.filter((alert) => alert.level === 'error');
    const last = errors[errors.length - 1];
    if (last !== undefined) found.push({ plugin, line: redactFailurePatterns(last.text) });
  }
  return found.sort((left, right) => left.plugin.localeCompare(right.plugin));
}

/**
 * Record what this fold could not load, or remove the record when it loaded
 * everything.
 *
 * Answers a line to log when the record itself could not be written, and never
 * throws: a host whose plugins all loaded must not refuse to start because it
 * could not say so beside its configuration.
 */
export function writePluginFailures(
  configDir: string,
  alerts: Readonly<Record<string, readonly Alert[]>>,
  now: Date = new Date(),
): string | undefined {
  const file = pluginFailuresPath(configDir);
  const failures = pluginFailuresOf(alerts);
  if (failures.length === 0) {
    try { unlinkSync(file); }
    catch (error) {
      if ((error as { code?: unknown }).code !== 'ENOENT') {
        return `plugin failures: could not remove ${file}: ${reason(error)}`;
      }
    }
    return undefined;
  }
  const record: PluginFailures = { at: now.toISOString(), failures };
  const staged = `${file}.${String(process.pid)}.tmp`;
  try {
    writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(staged, file);
  }
  catch (error) {
    try { unlinkSync(staged); }
    catch { /* the staging file may never have been written */ }
    return `plugin failures: could not write ${file}: ${reason(error)}`;
  }
  return undefined;
}

/**
 * The record, or nothing when no start has left one.
 *
 * A file that is there and is not a record throws: it is a fact about the
 * running host, and answering `undefined` would be the same false green the
 * record exists to end.
 */
export function readPluginFailures(configDir: string): PluginFailures | undefined {
  const file = pluginFailuresPath(configDir);
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${file} is not a plugin failure record: ${reason(error)}`); }
  const held = parsed as { at?: unknown; failures?: unknown };
  if (typeof held !== 'object' || held === null || typeof held.at !== 'string' || !Array.isArray(held.failures)) {
    throw new Error(`${file} is not a plugin failure record`);
  }
  const failures: PluginFailure[] = [];
  for (const entry of held.failures as unknown[]) {
    const one = entry as { plugin?: unknown; line?: unknown };
    if (typeof one !== 'object' || one === null || typeof one.plugin !== 'string' || typeof one.line !== 'string') {
      throw new Error(`${file} holds a failure that is not a plugin and a line`);
    }
    // A record written before this build may hold a line nothing redacted:
    // every reader gets it clean, and a keyed secret is never echoed on.
    failures.push({ plugin: one.plugin, line: redactFailurePatterns(one.line) });
  }
  return { at: held.at, failures };
}
