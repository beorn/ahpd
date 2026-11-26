import { join } from 'node:path';
import { expect, it } from 'vitest';
import { gitSync } from '../../../tools/git.ts';

/*
 * Every place the SDK reads whether the host has a users directory (#38446,
 * @cto fbdf4e14).
 *
 * A host with no directory trusts whoever reaches it - except a plugin's own
 * connection, which is held to its entry's grants. Five grant checks were
 * found reading `options.users` directly and so trusting a plugin there; each
 * now asks `heldToGrants` (host/gate.ts). This census is what catches the
 * next one: a new read, or a changed one, fails here until it is classified.
 *
 *   grant    - decides whether a caller may do something. Goes through
 *              heldToGrants (or seesConfig/seesAccount/mayUseAgent, which take
 *              the same `directory` flag), or is a check @cto ruled is not
 *              connection-keyed (806f0ee5).
 *   identity - who somebody is, who owns or holds what, how to sign in, or
 *              wiring the directory up; no grant is decided.
 *
 * Keyed by file and the line's text, so moving a line keeps its entry and
 * editing one asks for it to be looked at again. An entry names how many times
 * its exact line appears (1 unless said), so a copy of a classified line is
 * one more read to classify, not a read the entry already covers (@dev/1,
 * @cto c054f77a).
 */
type Kind = 'grant' | 'identity';
type Entry = readonly [file: string, line: string, kind: Kind, why: string, times?: number];
const ALLOWED: readonly Entry[] = [
  ['access/personrules.ts', 'const folder = options.users === undefined ? undefined : options.personPermissionsDir;', 'identity', "where a session owner's own approval settings are kept (#463 sync, upstream approvalSetting)"],
  ['host.ts', 'const directory = options.users !== undefined;', 'grant', 'fed to seesConfig/seesAccount, which ask heldToGrants'],
  ['host.ts', '? options.users?.watch?.(() => {', 'identity', 'watches the directory file for sign-in changes'],
  ['host/actions.ts', 'if (heldToGrants(connection, options.users !== undefined)) {', 'grant', 'the action gate, through heldToGrants'],
  ['host/actions.ts', 'const pusher = options.users !== undefined && connection.root !== true && action.replace !== true ? connection.principal?.id : undefined;', 'identity', 'whose approval keys a pushed config carries'],
  ['host/admission.ts', 'if (!heldToGrants(connection, ctx.options.users !== undefined)) return;', 'grant', 'the command gate, through heldToGrants'],
  ['host/admission.ts', "const signIn = (): Record<string, unknown> => (ctx.options.users === undefined ? {} : { resources: [ctx.options.users.resource] });", 'identity', 'where to sign in'],
  ['host/auth.ts', "const authenticationResource = (): string => String(options.users?.resource.resource ?? '');", 'identity', 'the sign-in resource'],
  ['host/auth.ts', 'if (options.users === undefined) return list;', 'identity', 'which auth resources to advertise'],
  ['host/auth.ts', 'if (options.users !== undefined && resource === authenticationResource()) return undefined;', 'identity', 'the sign-in resource is not an agent credential'],
  ['host/auth.ts', 'if (options.users !== undefined) out.add(authenticationResource());', 'identity', 'advertises the sign-in resource'],
  ['host/automations.ts', "if (requester !== undefined && options.users !== undefined && owner?.startsWith('user:') === true && person !== undefined && !person.can('session:create')) {", 'grant', "an automation's owner, not a connection (806f0ee5)"],
  ['host/automations.ts', "if (options.users !== undefined && computerSource(config.computer) !== undefined && owner?.startsWith('user:') === true) {", 'grant', "an automation's owner, not a connection (806f0ee5)"],
  ['host/automations.ts', "if (options.users !== undefined && owner?.startsWith('user:') === true) {", 'identity', 'whether an automation has a person as owner', 2],
  ['host/automations.ts', 'if (owner === undefined && options.users !== undefined) return [];', 'identity', "whose windows an automation owner's MCP sign-in is asked of; no grant is decided (#463 sync, upstream connectionsOf)"],
  ['host/chatactions.ts', 'const keeps = store !== undefined && (!heldToGrants(connection, ctx.options.users !== undefined)', 'grant', 'keeping a decision, through heldToGrants'],
  ['host/chatactions.ts', "if (allowsAll && heldToGrants(connection, ctx.options.users !== undefined) && connection.principal?.can('session:configure') !== true) {", 'grant', 'Allow All, through heldToGrants'],
  ['host/chatactions.ts', 'if (ctx.options.users === undefined || folder === undefined || person === undefined) break;', 'identity', "where a person's rules are kept"],
  ['host/chatactions.ts', 'const writesHost = !heldToGrants(connection, ctx.options.users !== undefined)', 'grant', "writing the host's rules, through heldToGrants"],
  ['host/handshake.ts', 'if (options.users !== undefined && connection.root !== true && connection.principal !== undefined', 'identity', 'who holds a client id on resume'],
  ['host/handshake.ts', 'if (options.users !== undefined && connection.principal !== undefined && holder === undefined && ownId(clientId)) {', 'identity', 'who holds a client id on resume'],
  ['host/handshake.ts', 'const signedOut = target === undefined && options.users !== undefined && resource === authenticationResource()', 'identity', 'sign-out'],
  ['host/handshake.ts', 'if (target === undefined && connection.root === true && options.users !== undefined && resource === authenticationResource()) return {};', 'identity', 'sign-in on the root'],
  ['host/handshake.ts', 'if (target === undefined && options.users !== undefined && resource === authenticationResource()) {', 'identity', 'sign-in'],
  ['host/handshake.ts', 'const held = await options.users.verify(token);', 'identity', 'sign-in'],
  ['host/handshake.ts', 'resources: [options.users.resource],', 'identity', 'where to sign in', 2],
  ['host/lifecycle.ts', 'if (!heldToGrants(sender, options.users !== undefined)) return true;', 'grant', 'a transcript excerpt, through heldToGrants'],
  ['host/lifecycle.ts', 'const checked = { hasDirectory: ctx.options.users !== undefined };', 'grant', 'mayUseAgent; with no directory every agent is the host’s'],
  ['host/owners.ts', 'if (options.users === undefined) return undefined;', 'identity', 'a session records no owner with no directory'],
  ['host/owners.ts', 'const nobody = answer === undefined && principal === undefined && options.users !== undefined;', 'identity', 'an owner nobody signed in as'],
  ['host/relay.ts', 'if (ctx.options.users === undefined || one.root === true) return true;', 'identity', 'claimsId: who holds a client id (806f0ee5)'],
  ['host/root.ts', '(options.users !== undefined && connection !== undefined && connection.root !== true ? connection.principal?.id : undefined);', 'identity', 'the person a connection is'],
  ['host/root.ts', 'const directory = options.users !== undefined;', 'grant', 'fed to seesConfig/seesAccount, which ask heldToGrants'],
  ['host/defaultagent.ts', 'mayUseAgentFor(acting, ownershipOf(ctx.options.agentOwners?.(), provider), { hasDirectory: ctx.options.users !== undefined });', 'grant', 'which agent the owner an automation acts for may use, as its default (upstream ab62733); asked of that owner, not a connection'],
  ['host/sessionmethods.ts', 'hasDirectory: options.users !== undefined,', 'grant', 'mayUseAgent, including the default agent a create that names none runs on (upstream ab62733); with no directory every agent is the host’s', 3],
  ['host/sessionmethods.ts', 'if (heldToGrants(connection, options.users !== undefined) && computerSource(placed.computer) !== undefined', 'grant', 'placing a session on a computer, through heldToGrants'],
  ['host/spawn.ts', 'const personRules = options.users === undefined || options.personPermissionsDir === undefined ? undefined : filePersonRules(options.personPermissionsDir);', 'identity', "where a person's rules are kept"],
  ['host/spawn.ts', 'if (options.users === undefined) return true;', 'grant', "a session's owner, not a connection (806f0ee5)", 3],
  ['host/spawn.ts', 'people: options.users !== undefined,', 'identity', 'whether the host has people'],
  ['host/tooling.ts', 'if (options.users === undefined) return undefined;', 'identity', "the person a chat's turn acts for"],
  ['host/tooling.ts', 'const hasDirectory = options.users !== undefined;', 'grant', 'mayUseAgent; with no directory every agent is the host’s'],
  ['host/tooling.ts', 'if (options.users === undefined || caller.root === true) return true;', 'grant', 'callerMay: a tool caller, not a connection (806f0ee5)'],
];

const key = (file: string, line: string): string => `${file}\u0000${line}`;

/**
 * Each read the allowlist does not cover, once per copy, and each entry that
 * names more copies than there are: what the tests below refuse.
 */
const census = (found: readonly (readonly [string, string])[], allowed: readonly Entry[]): { unclassified: string[]; stale: string[] } => {
  const left = new Map<string, number>();
  for (const [file, line, , , times = 1] of allowed) left.set(key(file, line), (left.get(key(file, line)) ?? 0) + times);
  const unclassified: string[] = [];
  for (const [file, line] of found) {
    const n = left.get(key(file, line)) ?? 0;
    if (n > 0) left.set(key(file, line), n - 1);
    else unclassified.push(`${file}: ${line}`);
  }
  const stale = [...left].filter(([, n]) => n > 0).map(([k, n]) => `${k.replace('\u0000', ': ')} (${n} more named than found)`);
  return { unclassified, stale };
};

const SRC = join(import.meta.dirname, '..', 'src');

/** Every line under packages/sdk/src that reads `options.users`, as [file relative to src, trimmed text]. */
const reads = (): [string, string][] => gitSync(['grep', '-n', '-E', String.raw`options\.users\b`, '--', '.'], { cwd: SRC, encoding: 'utf8' })
  .split('\n')
  .filter((one) => one !== '')
  .map((one) => {
    const [file, , ...text] = one.split(':');
    return [file ?? '', text.join(':').trim()];
  });

it('every read of options.users in the SDK is classified as a grant check or an identity read', () => {
  // A new read of whether the host has a users directory: if it decides what a caller may do, ask
  // heldToGrants(connection, directory) instead, so a plugin's connection is held to its grants;
  // then add the line here, tagged with its kind and why (or raise its count, for a copy of one).
  expect(census(reads(), ALLOWED).unclassified).toEqual([]);
});

it('every allowlist entry still names as many reads as there are, so the list shrinks as reads go', () => {
  expect(census(reads(), ALLOWED).stale).toEqual([]);
});

it('a copy of a classified line is a read to classify, not one its entry already covers', () => {
  const line = 'if (options.users === undefined) return true;';
  const allowed: Entry[] = [['host/spawn.ts', line, 'grant', 'owner', 3]];
  const three: [string, string][] = [['host/spawn.ts', line], ['host/spawn.ts', line], ['host/spawn.ts', line]];
  expect(census(three, allowed)).toEqual({ unclassified: [], stale: [] });
  expect(census([...three, ['host/spawn.ts', line]], allowed).unclassified).toEqual([`host/spawn.ts: ${line}`]);
  expect(census(three.slice(1), allowed).stale).toEqual([`host/spawn.ts: ${line} (1 more named than found)`]);
});
