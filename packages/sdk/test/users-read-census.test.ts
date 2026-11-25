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
 * editing one asks for it to be looked at again.
 */
type Kind = 'grant' | 'identity';
const ALLOWED: readonly (readonly [file: string, line: string, kind: Kind, why: string])[] = [
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
  ['host/automations.ts', "if (options.users !== undefined && owner?.startsWith('user:') === true) {", 'identity', 'whether an automation has a person as owner'],
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
  ['host/handshake.ts', 'resources: [options.users.resource],', 'identity', 'where to sign in'],
  ['host/lifecycle.ts', 'if (!heldToGrants(sender, options.users !== undefined)) return true;', 'grant', 'a transcript excerpt, through heldToGrants'],
  ['host/lifecycle.ts', 'const checked = { hasDirectory: ctx.options.users !== undefined };', 'grant', 'mayUseAgent; with no directory every agent is the host’s'],
  ['host/owners.ts', 'if (options.users === undefined) return undefined;', 'identity', 'a session records no owner with no directory'],
  ['host/owners.ts', 'const nobody = answer === undefined && principal === undefined && options.users !== undefined;', 'identity', 'an owner nobody signed in as'],
  ['host/relay.ts', 'if (ctx.options.users === undefined || one.root === true) return true;', 'identity', 'claimsId: who holds a client id (806f0ee5)'],
  ['host/root.ts', '(options.users !== undefined && connection !== undefined && connection.root !== true ? connection.principal?.id : undefined);', 'identity', 'the person a connection is'],
  ['host/root.ts', 'const directory = options.users !== undefined;', 'grant', 'fed to seesConfig/seesAccount, which ask heldToGrants'],
  ['host/sessionmethods.ts', 'hasDirectory: options.users !== undefined,', 'grant', 'mayUseAgent; with no directory every agent is the host’s'],
  ['host/sessionmethods.ts', 'if (heldToGrants(connection, options.users !== undefined) && computerSource(placed.computer) !== undefined', 'grant', 'placing a session on a computer, through heldToGrants'],
  ['host/spawn.ts', 'const personRules = options.users === undefined || options.personPermissionsDir === undefined ? undefined : filePersonRules(options.personPermissionsDir);', 'identity', "where a person's rules are kept"],
  ['host/spawn.ts', 'if (options.users === undefined) return true;', 'grant', "a session's owner, not a connection (806f0ee5)"],
  ['host/spawn.ts', 'people: options.users !== undefined,', 'identity', 'whether the host has people'],
  ['host/tooling.ts', 'if (options.users === undefined) return undefined;', 'identity', "the person a chat's turn acts for"],
  ['host/tooling.ts', 'const hasDirectory = options.users !== undefined;', 'grant', 'mayUseAgent; with no directory every agent is the host’s'],
  ['host/tooling.ts', 'if (options.users === undefined || caller.root === true) return true;', 'grant', 'callerMay: a tool caller, not a connection (806f0ee5)'],
];

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
  const known = new Set(ALLOWED.map(([file, line]) => `${file}\u0000${line}`));
  const unclassified = reads().filter(([file, line]) => !known.has(`${file}\u0000${line}`)).map(([file, line]) => `${file}: ${line}`);
  // A new read of whether the host has a users directory: if it decides what a caller may do, ask
  // heldToGrants(connection, directory) instead, so a plugin's connection is held to its grants;
  // then add the line here, tagged with its kind and why.
  expect(unclassified).toEqual([]);
});

it('every allowlist entry still names a read, so the list shrinks as reads go', () => {
  const present = new Set(reads().map(([file, line]) => `${file}\u0000${line}`));
  expect(ALLOWED.filter(([file, line]) => !present.has(`${file}\u0000${line}`)).map(([file, line]) => `${file}: ${line}`)).toEqual([]);
});
