import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Bag } from '../types/common.js';
import type { Owner } from '../types/usage.js';
import type { HostOptions } from '../types/host.js';
import { withGrant } from '../host/permissions.js';

/**
 * The root config keys a window pushes that decide what runs or is written
 * without a question, and the restriction its policy puts on auto-approval.
 * On a host with users each person keeps their own, since
 * a value for the whole host would let one person's window approve commands
 * in everybody's sessions.
 */
export const APPROVAL_KEYS: readonly string[] = ['terminalAutoApproveRules', 'terminalAutoApproveEnabled', 'editAutoApprovePatterns', 'autoApprovePolicyRestricted'];

/** The schema mark a root config key a person keeps their own value of carries, with the value `person`. */
export const SCOPE_MARK = 'x-ahpd-scope';

/**
 * The permission rules and approval settings each person keeps for their own
 * sessions, a file per person in one folder: `<folder>/<person>.json`, holding
 * a `permissions` value of `allow` and `deny` lists, as a session's and the
 * host's are written, and the person's own value of each of `APPROVAL_KEYS`.
 */
export interface PersonRules {
  /** One person's `permissions` value, or nothing where they keep none or the file does not read. */
  read(person: string): Bag | undefined;
  /** Adds rules to one person's `allow`, and answers whether anything was written. */
  grant(person: string, rules: readonly string[]): boolean;
  /** One person's own values of `APPROVAL_KEYS`, those they keep and no other key. */
  settings(person: string): Bag;
  /**
   * Keeps one person's values of `APPROVAL_KEYS`, a `null` taking a key back,
   * and answers whether anything was written. Any other key is left out.
   */
  keep(person: string, values: Bag): boolean;
}

/** The person an owner is, for a person's own rules: a signed-in user, and nobody else. */
export const personOf = (owner: Owner | undefined): string | undefined =>
  (owner?.startsWith('user:') === true ? owner.slice('user:'.length) : undefined);

/**
 * One of `APPROVAL_KEYS` as it holds in a session: the owner's own value where
 * the host has users and the owner keeps one, the host's otherwise.
 */
export const approvalSetting = (options: Pick<HostOptions, 'users' | 'personPermissionsDir'>, rootConfig: Bag, owner: Owner | undefined, key: string): unknown => {
  const folder = options.users === undefined ? undefined : options.personPermissionsDir;
  const person = personOf(owner);
  const own = folder === undefined || person === undefined ? {} : filePersonRules(folder).settings(person);
  return Object.hasOwn(own, key) ? own[key] : rootConfig[key];
};

/** The file one person's rules are kept in, or nothing for an id that would name a file outside the folder. */
const fileOf = (folder: string, person: string): string | undefined => {
  const name = encodeURIComponent(person);
  return name === '' || name === '.' || name === '..' ? undefined : join(folder, `${name}.json`);
};

/** The person rules kept under `folder`, written with a temporary name and a rename, so a crash leaves the old file whole. */
export const filePersonRules = (folder: string): PersonRules => {
  /** One person's whole file, or an empty one where it is missing or does not read. */
  const whole = (person: string): Bag => {
    const file = fileOf(folder, person);
    if (file === undefined) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Bag : {};
    }
    catch {
      return {};
    }
  };
  /** Write one person's whole file, with a temporary name and a rename. */
  const write = (person: string, value: Bag): boolean => {
    const file = fileOf(folder, person);
    if (file === undefined) return false;
    mkdirSync(folder, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
    return true;
  };
  const read = (person: string): Bag | undefined => {
    const permissions = whole(person).permissions;
    return typeof permissions === 'object' && permissions !== null && !Array.isArray(permissions) ? permissions as Bag : undefined;
  };
  return {
    read,
    grant: (person, rules) => {
      if (fileOf(folder, person) === undefined) return false;
      const permissions = withGrant(read(person), rules);
      if (permissions === undefined) return false;
      return write(person, { ...whole(person), permissions });
    },
    settings: (person) => {
      const held = whole(person);
      return Object.fromEntries(APPROVAL_KEYS.filter((key) => Object.hasOwn(held, key)).map((key) => [key, held[key]]));
    },
    keep: (person, values) => {
      if (fileOf(folder, person) === undefined) return false;
      const next = { ...whole(person) };
      for (const key of APPROVAL_KEYS) {
        if (!Object.hasOwn(values, key)) continue;
        if (values[key] === null || values[key] === undefined) delete next[key];
        else next[key] = values[key];
      }
      return write(person, next);
    },
  };
};
