import { lookup } from 'node:dns/promises';
import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND, RpcError, optionalStringParam, stringParam } from '../rpc.js';
import { Status, idOf } from '../sessions/catalog.js';
import { isWorktreeUnderRepository, worktreeFor, worktreesOf } from '../repo/worktrees.js';
import { DiskUsageCancelled, identityOf, measureDiskUsage } from '../repo/diskusage.js';
import { hostLogPath } from '../sessions/debuglogs.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { URI } from '../vscode/uri.js';
import { bag, str } from '../utils/values.js';
import { ROOT, spaceOf } from './channels.js';
import { need, reason } from './common.js';
import { ARCHIVE_COMMIT_MESSAGE, symlinkFolders } from './lifecycle.js';
import {
  isChatScratchFolder, newChatScratchFolder, readChatWorkspaceValue, removeChatScratchFolder,
  requireChatForWorkspace, requireNonScratchChatFolder, requireWorkspaceAuthority,
} from './chatworkspace.js';
import { createSessionMover } from './sessionmethods.js';
import { stageImportChunk } from './sessionimport.js';
import { requireTrust } from './trust.js';
import {
  AGENT_HOST_FIRST_RESPONSE_SPAN, USER_INTERACTION_SPAN, firstResponseAttributes, firstResponseRecord,
  userInteractionAttributes, userInteractionRecord,
} from './timing.js';
import type { LogFile } from '../sessions/debuglogs.js';
import type { Bag } from '../types/common.js';
import { DEV_CONTAINER_ENVIRONMENT_IMAGES, isDevContainerEnvironmentId, type ContainerConnect, type ContainerConnectResult, type ContainerEnvironmentConnect, type ContainerSink, type ContainerUserState } from '../types/containers.js';
import type { Owner } from '../types/usage.js';
import type { ConnectionContext, DetachedWorktree, HostContext } from './context.js';

/**
 * The proxy variables the network diagnostics report, when set: the reference
 * host's list.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L44-L48
 */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'COPILOT_PROXY_KERBEROS_SPN'] as const;
/** How long a network probe waits, and how much of the body it keeps. */
const PROBE_TIMEOUT = 10_000;
const MAX_BODY = 64 * 1024;

/** One address lookup for the network diagnostics, timed and never thrown. */
const resolved = async (host: string, family: 4 | 6): Promise<{ address?: string; durationMs: number; error?: string }> => {
  const began = Date.now();
  try {
    const { address } = await Promise.race([
      lookup(host, { family }),
      new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error(`Timed out after ${PROBE_TIMEOUT / 1000}s`)); }, PROBE_TIMEOUT).unref?.(); }),
    ]);
    return { address, durationMs: Date.now() - began };
  }
  catch (error) {
    return { durationMs: Date.now() - began, error: reason(error) };
  }
};

/** How long an unclaimed handle, or a claimed one nobody has seen, is kept before a reconcile may reap it. */
const DETACHED_GRACE = 24 * 60 * 60 * 1000;

/**
 * The shape of a handle this host hands out for a tree the window made: a
 * UUID, as VS Code checks one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentDevContainerWorktreeMeta.ts#L17-L19
 */
const WORKTREE_HANDLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** How much of the launcher's output is kept to explain an ending. */
const CONTAINER_TAIL = 24;

/** The source a session names to be placed in a folder's own dev container. */
const DEV_CONTAINER_SOURCE = 'devcontainer://';

/**
 * Whether a value is one automation's resource, as VS Code checks one: the
 * `ahp-automation` scheme, a path, and no authority, query or fragment.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4012-L4014
 */
const isAutomationUri = (value: string): boolean => {
  try {
    const uri = URI.parse(value);
    return uri.scheme === 'ahp-automation' && uri.path !== '' && uri.authority === ''
      && uri.query === '' && uri.fragment === '';
  } catch {
    return false;
  }
};

/**
 * Whether a value is a session a deletion may name: a session's own URI, and
 * not a chat's, a terminal's, a file's or a plugin's.
 */
const isSessionUri = (value: string): boolean => {
  try {
    const uri = URI.parse(value);
    const space = spaceOf(value);
    return uri.path !== '' && uri.authority === '' && uri.query === '' && uri.fragment === ''
      && (space === 'session' || space === undefined);
  } catch {
    return false;
  }
};

/** The session URIs a deletion carries under `legacySessions`. */
const legacySessionsOf = (params: Record<string, unknown>): string[] => {
  const value = params.legacySessions;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string'))
    throw new RpcError(INVALID_PARAMS, 'legacySessions must be an array of session URIs');
  return value;
};

/**
 * The model a backend's restored turns last ran on, as a draft names one.
 *
 * A restored turn carries the model on its own message where the backend wrote
 * one, and otherwise on its usage, which is where a transcript records the
 * model that answered it. Read from the last turn that says, since a session
 * whose last turn is a question has no model of its own.
 */
const modelOf = (turns: Bag[]): { id: string } | undefined => {
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const turn = bag(turns[at]);
    const chosen = bag(bag(turn.message).model);
    const id = str(chosen.id) ?? str(bag(turn.usage).model);
    if (id !== undefined && id !== '') return { id };
  }
  return undefined;
};

/**
 * A dev container's folder as a path of the platform the host runs on. On
 * Windows a host URI's path, `/c:/work`, names the file it is the path of,
 * and every separator is a backslash, as VS Code's protocol reads one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L26-L34
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/uri.ts#L636-L660
 */
export const normalizeDevContainerWorkspaceFolder = (workspaceFolder: string, platform: NodeJS.Platform): string => {
  if (platform !== 'win32') return workspaceFolder;
  const letter = workspaceFolder.charCodeAt(1);
  const drive = workspaceFolder.startsWith('/') && !workspaceFolder.startsWith('//') && workspaceFolder.charAt(2) === ':'
    && ((letter >= 65 && letter <= 90) || (letter >= 97 && letter <= 122));
  return (drive ? workspaceFolder.slice(1) : workspaceFolder).replaceAll('/', '\\');
};

/**
 * The methods the reference window asks of its own host, and the diagnostics
 * it asks the process about.
 *
 * The worktree handles it holds, the session state file and the logs it
 * collects, its own shutdown, and the devContainer requests the relay is
 * decided on.
 */
export interface VscodeMethods {
  'vscode/createAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/claimAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/sessionWorktreeCleanup': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/prepareSessionWorktreeCleanup': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/listManagedWorktrees': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/cleanupManagedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/measureWorktreeDiskUsage': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/moveSession': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/importSession': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/setChatWorkspace': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/deleteAutomation': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/acknowledgeAutomationDeletion': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/stageCreateSessionImportChunk': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/cancelWorktreeDiskUsage': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/setAgentHostDetachedWorktreeArchived': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/deleteAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/reconcileAgentHostDetachedWorktrees': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/removeSessionArtifact': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/stopBackgroundWork': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/answerShellAuthentication': (params: Record<string, unknown>) => Promise<unknown>;
  'x-ahpd/backgroundToolCall': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/getAgentHostSessionStateFile': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/collectAgentHostDebugLogs': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/cancelAgentHostDebugLogs': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/readAgentHostDebugLogsChunk': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/reportAgentHostFirstResponse': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/reportChatUserInteraction': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/isDockerAvailable': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/connect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/connectEnvironment': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/removeEnvironment': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/disconnect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/relaySend': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/stop': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/remove': (params: Record<string, unknown>) => Promise<unknown>;
  shutdown: (params: Record<string, unknown>) => Promise<unknown>;
  getNetworkDiagnosticsInfo: (params: Record<string, unknown>) => Promise<unknown>;
  getManagedSettingsDiagnostics: (params: Record<string, unknown>) => Promise<unknown>;
  diagnosticsFetch: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createVscodeMethods(ctx: HostContext, conn: ConnectionContext): VscodeMethods {
  const { connection } = conn;
  const moveSession = createSessionMover(ctx);
  const {
    agents, byChat, detached, dirOf, kept, leadOf, log, logs, options, ownerFor, owners, principals,
    sessionFor, sessions, setArtifacts,
  } = ctx;

  /** The folders linked into a session's tree, whose links are not work in it. */
  const linkedOf = (session: string): string[] => symlinkFolders(kept.config(idOf(session)) ?? ctx.decided.get(session) ?? {});

  /*
   * The worktree cleanup four, as VS Code's host serves them over its removal
   * queue: a session's status, a retry and a force, and the managed worktrees
   * no session holds.
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L141-L452
   */
  /** A worktree this host made: in the folder it makes trees in, named for an `agents/` branch it is on. */
  const managedTree = (repository: string, path: string, branch: string | undefined): boolean =>
    branch !== undefined && /(?:^|\/)agents\//.test(branch) && basename(path) === worktreeFor(branch)
      && (isWorktreeUnderRepository(path, repository) || (options.worktreesRoot !== undefined && resolve(dirname(path)) === resolve(worktreesOf(repository, options.worktreesRoot))));
  /** Whether a session's tree record, a detached worktree, or anything `treeInUse` finds still uses `path`. */
  const managedInUse = async (path: string): Promise<boolean> =>
    ctx.worktreeRecorded(path) || [...detached.values()].some((one) => one.path === path) || await treeInUse(path);
  const archivedNow = (session: string): boolean => (kept.flags(idOf(session)) & Status.IsArchived) !== 0;
  const knownSession = (session: string): boolean => ctx.sessions.has(session) || kept.provider(idOf(session)) !== undefined;

  /*
   * A worktree's disk usage, as VS Code's host measures one: at most two scans
   * across every connection, a request id of the asking connection's own, and
   * a measure for a session kept until the session moves or runs a turn.
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4148-L4189
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/worktreeDiskUsage.ts#L42-L110
   */
  /** What a kept measure of a session is good for: the session idle, its last move, and the folder itself. */
  const revisionOf = async (session: string, root: string): Promise<string | undefined> => {
    if ((ctx.statusOf(session) & Status.InProgress) !== 0) return undefined;
    const moved = ctx.rowOf(session).modifiedAt;
    const identity = await identityOf(root);
    return typeof moved === 'string' && moved !== '' && identity !== undefined ? `${moved}\u0000${identity}` : undefined;
  };

  const measureFor = async (root: string, signal: AbortSignal, session: string | undefined): Promise<number | undefined> => {
    if (session === undefined) return await ctx.diskUsage.slot(() => measureDiskUsage(root, signal));
    const key = `${session}\u0000${root}`;
    const revision = await revisionOf(session, root);
    const kept = ctx.diskUsage.kept.get(key);
    if (revision === undefined) ctx.diskUsage.kept.delete(key);
    else if (kept?.revision === revision) return kept.bytes;
    const bytes = await ctx.diskUsage.slot(() => measureDiskUsage(root, signal));
    // Kept only when nothing moved while it ran.
    if (revision !== undefined && await revisionOf(session, root) === revision) ctx.diskUsage.kept.set(key, { revision, bytes });
    return bytes;
  };

  const measureWorktreeDiskUsage = async (params: Record<string, unknown>): Promise<unknown> => {
    const uri = stringParam(params, 'uri');
    const requestId = stringParam(params, 'requestId');
    const session = optionalStringParam(params, 'session');
    let root: string;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== 'file:' || !uri.startsWith('file:/') || parsed.search !== '' || parsed.hash !== '') throw new Error('not a file URI');
      root = localPath(uri);
    }
    catch {
      throw new RpcError(INVALID_PARAMS, 'uri must be an absolute file URI');
    }
    if (!isAbsolute(root)) throw new RpcError(INVALID_PARAMS, 'uri must be an absolute file URI');
    const mine = ctx.diskUsage.scans.get(connection) ?? new Map<string, AbortController>();
    if (mine.has(requestId)) throw new RpcError(INVALID_PARAMS, 'requestId is already in use');
    const scan = new AbortController();
    mine.set(requestId, scan);
    ctx.diskUsage.scans.set(connection, mine);
    try {
      // Two asks of one worktree for a session wait one behind the other, so the second reads what the first kept.
      const run = (): Promise<number | undefined> => measureFor(root, scan.signal, session);
      let bytes: number | undefined;
      if (session === undefined) bytes = await run();
      else {
        const before = ctx.diskUsage.queues.get(root) ?? Promise.resolve();
        const mineToo = before.catch(() => undefined).then(run);
        ctx.diskUsage.queues.set(root, mineToo);
        try { bytes = await mineToo; }
        finally { if (ctx.diskUsage.queues.get(root) === mineToo) ctx.diskUsage.queues.delete(root); }
      }
      return bytes === undefined ? {} : { sizeBytes: bytes };
    }
    catch (error) {
      if (error instanceof DiskUsageCancelled || scan.signal.aborted) throw new RpcError(INTERNAL_ERROR, 'Canceled');
      throw error;
    }
    finally {
      mine.delete(requestId);
      if (mine.size === 0 && ctx.diskUsage.scans.get(connection) === mine) ctx.diskUsage.scans.delete(connection);
    }
  };

  /** Record a managed working directory a session has no tree record of, as VS Code adopts one before its cleanup. */
  const prepareSessionWorktreeCleanup = async (session: string): Promise<void> => {
    if (!knownSession(session)) throw new RpcError(INVALID_PARAMS, 'Only existing sessions can prepare worktree cleanup.');
    const port = options.worktrees;
    if (port?.list === undefined || kept.worktree?.(idOf(session)) !== undefined) return;
    const dir = ctx.dirOf(session);
    if (dir === undefined) return;
    const repository = await port.repository(dir).catch(() => undefined);
    if (repository === undefined) return;
    const entry = (await port.list(repository).catch(() => [])).find((one) => one.path === dir);
    if (entry === undefined || !managedTree(repository, entry.path, entry.branch)) return;
    kept.setWorktree?.(idOf(session), { repository, path: entry.path, base: entry.branch ?? 'HEAD', ...(entry.branch === undefined ? {} : { branch: entry.branch }) });
    log(`recorded ${entry.path} as the worktree of ${session}, ahead of its cleanup`);
  };

  const sessionWorktreeCleanup = async (params: Record<string, unknown>): Promise<unknown> => {
    const session = stringParam(params, 'session');
    const retry = params['retry'] === true;
    const force = params['force'] === true;
    const removals = ctx.worktreeRemovals;
    if (force && !retry) throw new RpcError(INVALID_PARAMS, 'Forced cleanup requires an explicit retry.');
    if (retry) {
      if (!knownSession(session) || !archivedNow(session)) throw new RpcError(INVALID_PARAMS, 'Only archived sessions can retry worktree cleanup.');
      await prepareSessionWorktreeCleanup(session);
      await ctx.requestSessionWorktreeRemoval(session);
    }
    if (force) {
      const left = await removals.processNow(removals.ofSession(session), true);
      if (left.length > 0) throw new RpcError(INTERNAL_ERROR, left[0]?.lastAttempt?.message ?? 'The worktree could not be forcibly removed. It may still be in use.');
      return { state: 'unknown' };
    }
    return removals.sessionStatus(session, () => ctx.sessions.has(session));
  };

  const listManagedWorktrees = async (params: Record<string, unknown>): Promise<unknown> => {
    const asked = params['repositories'];
    if (!Array.isArray(asked) || asked.some((one) => typeof one !== 'string')) throw new RpcError(INVALID_PARAMS, 'repositories must be a list of URIs');
    const port = options.worktrees;
    if (port?.list === undefined) return [];
    const seen = new Set<string>();
    const out: { repository: string; worktree: string; branch: string; cleanupStatus: unknown }[] = [];
    for (const one of asked as string[]) {
      if (!one.startsWith('file:') && !isAbsolute(one)) throw new RpcError(INVALID_PARAMS, 'Worktree inventory requires a host-local repository.');
      const repository = await port.repository(localPath(one)).catch(() => undefined);
      if (repository === undefined || seen.has(repository)) continue;
      seen.add(repository);
      for (const entry of await port.list(repository).catch(() => [])) {
        if (entry.branch === undefined || !managedTree(repository, entry.path, entry.branch)) continue;
        const record = ctx.worktreeRemovals.managed(entry.path);
        const cleanupStatus = await managedInUse(entry.path) ? { state: 'inUse' } : record === undefined ? { state: 'unknown' } : ctx.worktreeRemovals.statusOf(record);
        out.push({ repository: uriOf(repository), worktree: uriOf(entry.path), branch: entry.branch, cleanupStatus });
      }
    }
    return out.sort((a, b) => a.worktree.localeCompare(b.worktree));
  };

  const cleanupManagedWorktree = async (params: Record<string, unknown>): Promise<void> => {
    const repository = localPath(stringParam(params, 'repository'));
    const path = localPath(stringParam(params, 'worktree'));
    const branch = stringParam(params, 'branch');
    const force = params['force'] === true;
    const port = options.worktrees;
    if (port?.list === undefined) throw new RpcError(INTERNAL_ERROR, 'This host does not manage worktrees.');
    const entry = (await port.list(repository).catch(() => [])).find((one) => one.path === path);
    if (entry === undefined || !managedTree(repository, path, entry.branch ?? branch)) throw new RpcError(INVALID_PARAMS, `Not a worktree this host manages: ${uriOf(path)}`);
    if (!force && entry.branch !== branch) throw new RpcError(INVALID_PARAMS, `The worktree moved from ${branch} to ${entry.branch ?? 'a detached HEAD'}.`);
    if (!force && await managedInUse(path)) throw new RpcError(INVALID_PARAMS, 'A session, chat, or detached worktree record is still using this worktree.');
    ctx.worktreeRemovals.request({ kind: 'managed', owner: path, repository, path, branch: entry.branch ?? branch, mode: 'commit' });
    const left = await ctx.worktreeRemovals.processNow([ctx.worktreeRemovals.managed(path)].filter((one) => one !== undefined), force);
    if (force && left.length > 0) throw new RpcError(INTERNAL_ERROR, left[0]?.lastAttempt?.message ?? 'The worktree could not be forcibly removed.');
  };

  /*
   * A Dev Container's folder vouched for by the window asking, before one is
   * started, stopped or removed there, and refused PermissionDenied in the
   * reference host's words otherwise.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L103-L108
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L166-L169
   */
  const vouchedFor = async (folder: string, refusal: string): Promise<void> => {
    await requireTrust({ folder, sender: connection, autoApproved: false })
      .catch(() => { throw new RpcError(AhpErrorCodes.PermissionDenied, refusal); });
  };

  /**
   * The backend's own file for a session, or for one chat of it.
   *
   * A chat here is its own backend session with an id of its own, so a chat
   * named is that id, a live one's or the one its record holds; a session
   * named is its lead's. A row that is not running has the id in its URI,
   * which is what the catalogue listed it by. A chat named is checked against
   * the session its record says owns it, as the reference host resolves a
   * chat's owner from its records, so a chat of a session nobody runs passes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4331
   */
  const stateFileOf = (session: string, chat?: string): string | undefined => {
    const uri = sessions.has(session) ? session : sessionFor(session);
    if (chat !== undefined && (spaceOf(chat) !== 'chat' || sessionFor(chat) !== uri)) {
      throw new RpcError(INVALID_PARAMS, 'chat must belong to the requested Agent Session');
    }
    const held = sessions.get(uri);
    const agent = held?.agent ?? owners.get(uri);
    const dir = dirOf(uri);
    if (agent?.stateFile === undefined || dir === undefined) return undefined;
    const own = chat === undefined
      ? (held ? leadOf(held)?.agentId() : undefined)
      : byChat.get(chat)?.chat.agentId() ?? ctx.recordedChat(idOf(uri), chat)?.backendId;
    return agent.stateFile(own ?? idOf(uri), dir);
  };

  /**
   * The `connectionId` a container request names, checked once.
   *
   * A `connectionId` is a name a client chose, so it is bounded: non-empty,
   * no NUL, and short enough to be an identifier rather than a payload. A
   * `connect` and a `disconnect` refuse it in one sentence, which is why the
   * check is one function rather than two.
   */
  const connectionIdOf = (params: Record<string, unknown>): string => {
    const id = typeof params.connectionId === 'string' ? params.connectionId : '';
    if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'connectionId must be a non-empty identifier');
    }
    return id;
  };

  /**
   * The `resume` flag a connect carries.
   *
   * Absent unless the client said `true` or `false`: whether a stopped source
   * may be started again is the client's statement, and a value of any other
   * type is not one.
   */
  const resumeOf = (params: Record<string, unknown>): boolean | undefined =>
    typeof params.resume === 'boolean' ? params.resume : undefined;

  /**
   * A boolean option a connect carries, absent unless the client said it.
   *
   * `persistUserState` and `sandboxEnabled` weaken or widen what a connect
   * makes, so a value of any other type is not one and an absent value is not
   * `true`.
   */
  const optionOf = (params: Record<string, unknown>, key: string): boolean | undefined =>
    typeof params[key] === 'boolean' ? params[key] as boolean : undefined;

  /**
   * The other two strings a `connect` carries, checked with the id: an
   * absolute folder on this host and a name, refused in one sentence, as
   * VS Code's protocol checks a connect.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L88-L95
   *
   * Whether the folder exists and has a container definition is the
   * launcher's to answer, because that is a question about a filesystem.
   * The owner is not among them: the client does not name one, and the
   * call below fills it from the connection the ask arrived on.
   */
  const containerAsk = (params: Record<string, unknown>): ContainerConnect => {
    const id = connectionIdOf(params);
    const folder = normalizeDevContainerWorkspaceFolder(typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '', process.platform);
    const name = typeof params.name === 'string' ? params.name : '';
    const resume = resumeOf(params);
    const persistUserState = optionOf(params, 'persistUserState');
    const sandboxEnabled = optionOf(params, 'sandboxEnabled');
    if (!isAbsolute(folder) || folder.includes('\0') || name.trim() === '' || name.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'workspaceFolder must be an absolute host path and name must be non-empty');
    }
    return {
      connectionId: id,
      workspaceFolder: folder,
      name,
      ...(resume === undefined ? {} : { resume }),
      ...(persistUserState === undefined ? {} : { persistUserState }),
      ...(sandboxEnabled === undefined ? {} : { sandboxEnabled }),
    };
  };

  /**
   * The strings an environment connect carries, refused in one sentence as
   * VS Code's protocol checks them.
   *
   * The id and the image are checked here rather than left to the launcher,
   * because the client is told what it got wrong before any container is made.
   * The name is the client's spelling and is not a path.
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts
   */
  const environmentAsk = (params: Record<string, unknown>): ContainerEnvironmentConnect => {
    const id = connectionIdOf(params);
    const environmentId = typeof params.environmentId === 'string' ? params.environmentId : '';
    const image = typeof params.image === 'string' ? params.image : '';
    const name = typeof params.name === 'string' ? params.name : '';
    const resume = resumeOf(params);
    const persistUserState = optionOf(params, 'persistUserState');
    const sandboxEnabled = optionOf(params, 'sandboxEnabled');
    if (
      !isDevContainerEnvironmentId(environmentId)
      || !DEV_CONTAINER_ENVIRONMENT_IMAGES.includes(image)
      || name.trim() === ''
      || name.includes('\0')
    ) {
      throw new RpcError(INVALID_PARAMS, 'environmentId must be a valid identifier, image must be supported, and name must be non-empty');
    }
    return {
      connectionId: id,
      environmentId,
      image,
      name,
      ...(resume === undefined ? {} : { resume }),
      ...(persistUserState === undefined ? {} : { persistUserState }),
      ...(sandboxEnabled === undefined ? {} : { sandboxEnabled }),
    };
  };

  /**
   * The one string a `disconnect` or a `relaySend` carries.
   *
   * The reference sends `{ connectionId }` and `{ connectionId, data }`,
   * so a folder is not asked for again: the connection was made with one.
   */
  const namedContainer = (params: Record<string, unknown>): string => connectionIdOf(params);

  /**
   * The folder a `stop` or a `remove` names: an absolute folder on this host,
   * as VS Code's protocol checks one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L139-L149
   *
   * The reference sends `{ workspaceFolder }` for both, and the folder is the
   * whole of what a dev container is: its `devcontainer.json` is the
   * definition and the machine is that folder's. A relative path is refused:
   * the folder it reaches depends on this process's working directory, which
   * no client chose.
   */
  const devFolder = (params: Record<string, unknown>): string => {
    const folder = normalizeDevContainerWorkspaceFolder(typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '', process.platform);
    if (!isAbsolute(folder) || folder.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'workspaceFolder must be an absolute host path');
    }
    return folder;
  };

  /** A folder as one path, so two spellings of one folder are one folder. */
  const atPath = (folder: string): string => {
    try { return realpathSync(folder); }
    catch { return resolve(folder); }
  };

  /**
   * Whether a connection other than this one still holds a relay on a folder.
   *
   * The reference host's own question, and the reason it answers `false` rather
   * than stopping a container another window has open. Every live connection's
   * map is held on the host for exactly this, since a name a client chose
   * reaches no other client and the folders are what can be compared.
   */
  const relayedByAnother = (folder: string): boolean => {
    const here = atPath(folder);
    for (const [who, held] of ctx.relays) {
      if (who === connection) continue;
      for (const one of held.values()) {
        if (one.folder !== undefined && atPath(one.folder) === here) return true;
      }
    }
    return false;
  };

  /**
   * Whether a session of this host is running in the folder's computer.
   *
   * The user the reference host has none of. A dev container is a `computer://`
   * machine here, and the sessions placed on one are this host's own. A session
   * that asked for the container by folder is what `sessionMachines` holds,
   * under the source it named; the folder is compared as a path, because the
   * source is a spelling a client chose and the folder a client names here is
   * another.
   */
  const placedOn = (folder: string): boolean => {
    const here = atPath(folder);
    for (const one of ctx.sessionMachines.values()) {
      if (!one.source.startsWith(DEV_CONTAINER_SOURCE)) continue;
      if (atPath(one.source.slice(DEV_CONTAINER_SOURCE.length).trim()) === here) return true;
    }
    return false;
  };

  /** The time on the host's clock, which a test moves. */
  const clock = (): number => (options.now?.() ?? new Date()).getTime();

  /** The handle a detached worktree request names, refused in VS Code's words when it is no handle this host hands out. */
  const handleOf = (params: Record<string, unknown>): string => {
    const { handle } = params;
    if (typeof handle !== 'string' || !WORKTREE_HANDLE.test(handle)) {
      throw new RpcError(INVALID_PARAMS, 'handle must be a valid worktree handle');
    }
    return handle;
  };

  /*
   * Whether anything uses a tree the window made: a session of this host
   * working in it, a relay into a container of that folder, or a session
   * placed on one, as VS Code keeps a folder another session uses.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L413-L416
   */
  const treeInUse = async (path: string): Promise<boolean> => {
    const here = atPath(path);
    if ((await ctx.listSessions()).some((summary) => summary.workingDirectories.some((one) => atPath(localPath(one)) === here))) return true;
    for (const held of ctx.relays.values()) {
      for (const one of held.values()) {
        if (one.folder !== undefined && atPath(one.folder) === here) return true;
      }
    }
    return placedOn(path);
  };

  /*
   * A tree the window made, taken away once nothing uses it, its branch kept
   * so an unarchive can put it back, as VS Code's host removes one. Work
   * nobody committed keeps it, as it keeps a session's own tree: an archive
   * under `archiveDirtyWorktree: commit` commits the work on the branch
   * first. Answers whether the tree is gone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1786-L1846
   */
  const takeDown = async (handle: string, held: DetachedWorktree, archiving: boolean): Promise<boolean> => {
    const port = options.worktrees;
    if (port === undefined) return false;
    if (!await stat(held.path).then(() => true, () => false)) return true;
    if (await treeInUse(held.path)) {
      log(`kept ${held.path}: it is in use`);
      return false;
    }
    const clean = async (): Promise<boolean> => await port.dirty(held.path, held.linked).catch(() => true) === false;
    if (!await clean()) {
      if (!archiving || ctx.archiveDirtyWorktree !== 'commit' || port.commit === undefined) {
        log(`kept ${held.path}: it has changes nobody committed`);
        return false;
      }
      const failed = await port.commit(held.path, ARCHIVE_COMMIT_MESSAGE, held.linked).then(() => undefined, reason);
      if (failed !== undefined || !await clean()) {
        log.warn(`kept ${held.path}: ${failed === undefined ? 'it still has changes after the commit' : `could not commit its changes: ${failed}`}`);
        return false;
      }
    }
    return port.remove(held.repository, held.path, undefined, held.linked).then(
      () => { log(`removed ${held.path} for ${handle}, keeping ${held.branch ?? held.base}`); return true; },
      (error: unknown) => { log.warn(`kept ${held.path}: ${reason(error)}`); return false; },
    );
  };

  /**
   * Stop or remove the computer a folder is, unless somebody else is using it.
   *
   * The reference host's own order: the folder's relays are ended, then the
   * container is stopped or removed, and the answer is whether anything was
   * done. This connection's own relays go first, so the host inside a container
   * is not left running in one that is about to stop; a relay another
   * connection holds, or a session placed on the computer, is what makes the
   * answer `false` instead.
   */
  const devContainerStopped = async (verb: 'stop' | 'remove', params: Record<string, unknown>): Promise<boolean> => {
    const method = `vscode/devContainers/${verb}`;
    const port = need(options.containers, method);
    const folder = devFolder(params);
    const act = verb === 'stop' ? port.stop : port.remove;
    // A launcher that cannot reach the runtime's own stop is refused as an
    // absent launcher is, a method this host does not have.
    if (act === undefined) throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    await vouchedFor(folder, 'Workspace trust is required to manage a Dev Container');
    if (relayedByAnother(folder) || placedOn(folder)) return false;
    const here = atPath(folder);
    for (const [id, held] of [...conn.containers]) {
      if (held.folder === undefined || atPath(held.folder) !== here) continue;
      conn.containers.delete(id);
      await port.disconnect(id);
    }
    return await act.call(port, folder);
  };

  /**
   * One relay into a container, whichever ask made it.
   *
   * The connection id is held before the first await, so a second connect under
   * the same name cannot slip in while this one is building an image. The
   * ending, the sink, the owner and the cleanup are the same for a folder's
   * container and an environment's; `begin` is the launcher call that differs,
   * `release` ends whatever the launcher began when the connect does not
   * finish, and `trust` is the folder's check, run here so a refusal frees the
   * name.
   */
  const startRelay = async (
    one: ContainerConnect | ContainerEnvironmentConnect,
    held: { name: string; folder?: string; environment?: string },
    begin: (sink: ContainerSink, owner: Owner | undefined) => Promise<ContainerConnectResult>,
    release: () => Promise<void>,
    trust?: () => Promise<void>,
  ): Promise<unknown> => {
    if (conn.containers.has(one.connectionId)) {
      throw new RpcError(INVALID_PARAMS, 'Dev Container connectionId is already in use');
    }
    conn.containers.set(one.connectionId, { ...held, tail: [] });
    if (trust !== undefined) {
      await trust().catch((refused: unknown) => { conn.containers.delete(one.connectionId); throw refused; });
    }
    /*
     * A starting line, because "asked for" and "never asked" otherwise look the
     * same in this log: the only other thing written about a container is its
     * ending, and by then the question has moved on.
     */
    const about = 'workspaceFolder' in one ? `in ${one.workspaceFolder}` : `for environment ${one.environmentId}`;
    log(`dev container ${one.connectionId} starting ${about}`);
    /**
     * The relay ended, whoever ended it.
     *
     * The map is what says whether this connection still owns it: an
     * explicit `disconnect` forgets the name first, so the client that
     * asked is not told what it already knows.
     */
    const ended = (why?: string): void => {
      const kept = conn.containers.get(one.connectionId);
      if (!conn.containers.delete(one.connectionId)) return;
      connection.peer.notify('vscode/devContainers/relayClose', { connectionId: one.connectionId });
      connection.peer.notify('vscode/devContainers/closeConnection', { connectionId: one.connectionId });
      if (why !== undefined && why !== '') {
        /*
         * The launcher's own last words, which are usually the reason.
         *
         * `ended: exit 1` was all this said, and the cause - a path that
         * does not exist inside the container, an install that failed -
         * was sent only to whichever client happened to be watching.
         */
        const tail = (kept?.tail ?? []).filter((line) => line.trim() !== '').slice(-8);
        log(`dev container ${one.connectionId} ended: ${why}${
          tail.length === 0 ? '' : `\n  ${tail.join('\n  ')}`}`);
      }
    };
    const sink: ContainerSink = {
      message: (data) => {
        connection.peer.notify('vscode/devContainers/relayMessage', { connectionId: one.connectionId, data });
      },
      userState: (notice: ContainerUserState) => {
        connection.peer.notify('vscode/devContainers/userState', { connectionId: one.connectionId, ...notice });
      },
      sandboxSupport: (supported: boolean) => {
        connection.peer.notify('vscode/devContainers/sandboxSupport', { connectionId: one.connectionId, supported });
      },
      output: (data) => {
        connection.peer.notify('vscode/devContainers/output', { connectionId: one.connectionId, data });
        // Kept for an ending to explain itself, bounded so a long build
        // cannot grow the daemon's memory with output nobody will read.
        const kept = conn.containers.get(one.connectionId);
        if (kept === undefined) return;
        for (const line of String(data).split('\n')) {
          if (line.trim() !== '') kept.tail.push(line);
        }
        if (kept.tail.length > CONTAINER_TAIL) {
          kept.tail.splice(0, kept.tail.length - CONTAINER_TAIL);
        }
      },
      close: (why) => { ended(why); },
    };
    let result: ContainerConnectResult;
    try {
      /*
       * Whose the container is, which the client cannot say.
       *
       * The connection is the whole of the answer: a person who has signed
       * in owns what their relay runs, and a connection the host made for
       * itself is the host.
       */
      result = await begin(sink, ownerFor(connection));
      log(`dev container ${one.connectionId} up: ${result.address} (${result.remoteWorkspaceFolder})`);
    }
    catch (error) {
      // Nothing left running: the launcher is told to release whatever it
      // had begun, and the name is free again.
      conn.containers.delete(one.connectionId);
      try { await release(); } catch { /* already gone */ }
      log.error(`dev container ${one.connectionId} failed: ${reason(error)}`);
      throw error;
    }
    if (!conn.alive) {
      // The client went while the image was building. Its containers are
      // not something to leave behind for nobody.
      conn.containers.delete(one.connectionId);
      try { await release(); } catch { /* already gone */ }
      log(`dev container ${one.connectionId} abandoned: the client went away while it was starting`);
      throw new Error(`The connection went away while ${one.connectionId} was starting`);
    }
    return { connectionId: one.connectionId, name: one.name, ...result };
  };

  /**
   * Give a chat's draft the model the backend restored, as VS Code's host
   * offers an imported chat the selection its provider imported: the text and
   * origin the person already had, and the model the turns last ran on.
   * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L2664-L2716
   */
  const offerModel = (id: string, chat: string, model: { id: string }): void => {
    const draft = {
      text: '',
      origin: { kind: 'user' },
      ...bag(ctx.stateOf(chat)?.draft ?? kept.chatDraft?.(id, chat)),
      model,
    };
    ctx.dispatch(chat, { type: 'chat/draftChanged', draft });
    byChat.get(chat)?.chat.setDraft(draft);
    kept.setChatDraft?.(id, chat, draft);
  };

  return {
    /*
     * A tree of the window's own for a creating session whose tree is
     * pending, answered by the handle the window holds it under and its
     * folder, as VS Code's host makes one; the lifecycle refuses any other
     * session in VS Code's words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3997-L4025
     */
    'vscode/createAgentHostDetachedWorktree': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      stringParam(params, 'prompt');
      if (!URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      const uri = sessionFor(session);
      const handle = crypto.randomUUID();
      const tree = await ctx.createDetachedWorktree(uri, handle);
      const now = clock();
      detached.set(handle, {
        repository: tree.repository,
        path: tree.path,
        base: tree.base,
        ...(tree.branch !== undefined ? { branch: tree.branch } : {}),
        linked: linkedOf(uri),
        claimed: false,
        archived: false,
        deleting: false,
        createdAt: now,
        lastSeenAt: now,
      });
      log(`${connection.clientId || 'a client'} holds ${handle} on ${tree.path}`);
      return { handle, resource: uriOf(tree.path) };
    },
    /*
     * A session started in the tree: the handle is in use and seen now. One
     * this host never handed out, or one the window asked to delete, is
     * refused in VS Code's words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L402-L407
     */
    'vscode/sessionWorktreeCleanup': async (params) => await sessionWorktreeCleanup(params),
    'vscode/prepareSessionWorktreeCleanup': async (params) => {
      await prepareSessionWorktreeCleanup(stringParam(params, 'session'));
      return {};
    },
    'vscode/listManagedWorktrees': async (params) => await listManagedWorktrees(params),
    'vscode/measureWorktreeDiskUsage': async (params) => await measureWorktreeDiskUsage(params),
    /*
     * One chunk of a conversation a client will import when it creates the
     * session, held on this connection until `createSession` takes it or the
     * connection closes.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4095-L4150
     */
    'vscode/stageCreateSessionImportChunk': async (params) => {
      const transferId = stringParam(params, 'transferId', 'a transfer id');
      const chunk = stringParam(params, 'chunk', 'a chunk of the conversation');
      const staged = stageImportChunk(conn.imports, transferId, chunk);
      if (staged === 'invalid') throw new RpcError(INVALID_PARAMS, 'Invalid createSession import chunk');
      if (staged === 'exceeds') throw new RpcError(INVALID_PARAMS, 'Staged createSession import exceeds maximum size');
      return {};
    },
    'vscode/moveSession': async (params) => await moveSession(connection, conn.tokensFor, params),
    /*
     * An external session made this host's own without a turn, as VS Code's
     * host imports one a window opens to continue: restored, its turns read
     * again where the host had already loaded it, its draft given the model
     * the backend restored, and the session adopted. `takeOver` is accepted
     * because a window sends it; no backend here keeps an in-use record to
     * take over.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3987-L4001
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L2599-L2621
     */
    'vscode/importSession': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      if (params.takeOver !== undefined && typeof params.takeOver !== 'boolean')
        throw new RpcError(INVALID_PARAMS, 'takeOver must be a boolean');
      if (!isSessionUri(session)) throw new RpcError(INVALID_PARAMS, 'session must be an Agent Session URI');
      const id = idOf(session);
      // A session this host runs is known even where its own record has no
      // transcript to read, as one the catalogue does not list yet.
      const live = sessions.has(session) || sessions.has(ctx.nameOf(id));
      const wasLoaded = ctx.loaded(id);
      const restored = await ctx.restoreSession(id);
      if (restored === undefined && !live)
        throw new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${session}`);
      // The name the session is known by, which a row this restore registered
      // has just settled.
      const name = ctx.nameOf(id);
      const turns = (wasLoaded ? await ctx.reloadSession(id) : undefined) ?? restored ?? [];
      const model = modelOf(turns);
      const chat = ctx.defaultChatFor(name);
      if (model !== undefined) offerModel(id, chat, model);
      /*
       * The person whose import adopted it owns it from then on, as a person's
       * first turn on an external session does: checked for the same thing,
       * the session being external and having no owner yet, and written before
       * the adoption is announced so the announcement carries the owner.
       * Neither a turn nor an import asks the caller to be the session's owner:
       * a member may drive a session that is not theirs, and the session it
       * drives is the host's either way.
       * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/chatContributions/externalSessionAdoption/externalSessionAdoptionContribution.ts#L25-L30
       */
      const who = ownerFor(connection);
      if (ctx.isExternal(name) && who !== undefined && kept.owner(id) === undefined) {
        kept.setOwner(id, who);
        if (connection.principal !== undefined) principals.set(who, connection.principal);
      }
      ctx.adoptExternalSession(name);
      return { session: name };
    },
    /*
     * A workspace given to a chat that has not started: a folder, a new
     * worktree of one, or a scratch folder this host makes. The move is the
     * one a chat's own tools make, with the calling window asked about the
     * folder's trust and no turn behind it, because the chat has none to
     * continue.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L7263-L7392
     */
    'vscode/setChatWorkspace': async (params) => {
      const chat = stringParam(params, 'chat', 'an AHP chat URI');
      const workspace = readChatWorkspaceValue(params.workspace);
      if (workspace === 'invalid') throw new RpcError(INVALID_PARAMS, 'Invalid chat workspace');
      const live = byChat.get(chat);
      const held = live === undefined ? undefined : sessions.get(live.uri);
      if (live === undefined || held === undefined)
        throw new RpcError(INVALID_PARAMS, `${chat} is not a chat of a session this host is running.`);
      const session = live.uri;
      requireWorkspaceAuthority({
        owner: ctx.kept.owner(idOf(session)),
        principal: connection.principal,
        root: connection.root === true,
      });
      const state = ctx.stateOf(chat);
      const queued = Array.isArray(state?.queuedMessages) ? state.queuedMessages.length : 0;
      requireChatForWorkspace({
        defaultChat: chat === held.defaultChat,
        origin: String(ctx.madeFrom.get(chat)?.kind ?? 'user'),
        started: (state?.activeTurn !== undefined && state.activeTurn !== null)
          || (state?.steeringMessage !== undefined && state.steeringMessage !== null)
          || queued > 0 || live.chat.allTurns().length > 0,
        provider: held.agent.provider,
        folderPerChat: held.agent.multipleDirectories === true,
      });
      if (workspace.kind === 'folder') requireNonScratchChatFolder(workspace.folder);
      if (ctx.chatWorkspaceMoves.has(chat)) throw new RpcError(INVALID_PARAMS, 'The chat is already being given a workspace.');
      // What the chat works in now, read before the move changes it.
      const was = live.chat.workingDirectories().map(localPath);
      const only = was.length === 1 ? was[0] : undefined;
      if (workspace.kind === 'folder' && workspace.isolation === 'folder'
        && only !== undefined && resolve(only) === resolve(workspace.folder)) return {};
      if (workspace.kind === 'scratch' && only !== undefined && isChatScratchFolder(only)) return {};
      ctx.chatWorkspaceMoves.add(chat);
      let made: string | undefined;
      try {
        let directory: string;
        if (workspace.kind === 'scratch') {
          made = await newChatScratchFolder();
          directory = made;
        }
        else directory = workspace.folder;
        await ctx.moveChatWorkspace(live.uri, {
          chat,
          directory,
          isolation: workspace.kind === 'folder' && workspace.isolation === 'worktree',
          sender: connection,
          continuation: false,
          trust: workspace.kind !== 'scratch',
          ...(workspace.kind === 'folder' && workspace.isolation === 'worktree' && workspace.baseBranch !== undefined
            ? { baseBranch: workspace.baseBranch }
            : {}),
        });
        /*
         * The folders the chat leaves. One another chat of the session still
         * works in is not the leaving chat's to release, and the session's
         * primary is never released. A released folder leaves the session's
         * set, and a scratch folder made for the chat goes from disk.
         */
        const after = (byChat.get(chat)?.chat.workingDirectories() ?? []).map(localPath);
        const at = after.length === 1 ? after[0] : undefined;
        const primary = held.workingDirectory === undefined ? undefined : resolve(held.workingDirectory);
        let released = false;
        for (const folder of was) {
          const here = resolve(folder);
          if ((at !== undefined && here === resolve(at)) || (primary !== undefined && here === primary)) continue;
          const shared = [...held.chats.entries()].some(([other, one]) => other !== chat
            && one.workingDirectories().some((where) => resolve(localPath(where)) === here));
          if (shared) continue;
          if ((held.additional ?? []).some((one) => resolve(one) === here)) {
            held.additional = (held.additional ?? []).filter((one) => resolve(one) !== here);
            ctx.dispatch(session, { type: 'session/workingDirectoryRemoved', directory: uriOf(folder) });
            released = true;
          }
          if (isChatScratchFolder(folder)) await removeChatScratchFolder(folder);
        }
        if (released) {
          // The session's backend starts again in its folders at the next turn
          // boundary, as the folder action itself asks.
          const due = ctx.relaunches.get(session);
          ctx.relaunches.set(session, {
            config: due?.config ?? {},
            folders: true,
            credentials: conn.tokensFor(held.agent.provider),
            tokensFor: conn.tokensFor,
          });
        }
      }
      catch (error) {
        if (made !== undefined) await removeChatScratchFolder(made);
        throw error;
      }
      finally { ctx.chatWorkspaceMoves.delete(chat); }
      return {};
    },
    /*
     * Deleting an automation, and with `deleteHistory` the sessions its runs
     * made. The history a client remembers itself arrives under
     * `legacySessions`, and is refused unless the same request deletes it.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4003-L4031
     */
    'vscode/deleteAutomation': async (params) => {
      const automation = stringParam(params, 'automation', 'an automation URI');
      if (!isAutomationUri(automation)) {
        throw new RpcError(INVALID_PARAMS, `automation must be an ahp-automation URI with a path and no authority, query or fragment: ${automation}`);
      }
      if (params.deleteHistory !== undefined && typeof params.deleteHistory !== 'boolean')
        throw new RpcError(INVALID_PARAMS, 'deleteHistory must be a boolean');
      const deleteHistory = params.deleteHistory === true;
      const legacySessions = legacySessionsOf(params);
      if (legacySessions.length > 0 && !deleteHistory)
        throw new RpcError(INVALID_PARAMS, 'legacySessions may be given only with deleteHistory');
      for (const one of legacySessions) {
        if (!isSessionUri(one))
          throw new RpcError(INVALID_PARAMS, `legacySessions must name session URIs: ${one}`);
      }
      const requestId = optionalStringParam(params, 'requestId', 'a request id');
      return await ctx.deleteAutomation(automation, deleteHistory, legacySessions, requestId, connection.principal);
    },
    /*
     * Dropping what a deletion answered once the client has it, as VS Code
     * does after it reads the receipt a retry found.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4033-L4041
     */
    'vscode/acknowledgeAutomationDeletion': async (params) => {
      const requestId = stringParam(params, 'requestId', 'a request id');
      ctx.acknowledgeAutomationDeletion(requestId);
      return {};
    },
    'vscode/cancelWorktreeDiskUsage': (params) => {
      ctx.diskUsage.scans.get(connection)?.get(stringParam(params, 'requestId'))?.abort();
      return Promise.resolve({});
    },
    'vscode/cleanupManagedWorktree': async (params) => {
      await cleanupManagedWorktree(params);
      return {};
    },
    'vscode/claimAgentHostDetachedWorktree': async (params) => {
      const handle = handleOf(params);
      const held = detached.get(handle);
      if (held === undefined || held.deleting) throw new RpcError(INTERNAL_ERROR, `Unknown detached worktree handle: ${handle}`);
      held.claimed = true;
      held.lastSeenAt = clock();
      return {};
    },
    /*
     * Archived is the tree taken down once nothing uses it, its branch kept
     * so it can come back; unarchived is the tree put back on that branch.
     * A handle nobody holds is nothing to do, as VS Code's host answers it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L371-L400
     */
    'vscode/setAgentHostDetachedWorktreeArchived': async (params) => {
      const handle = handleOf(params);
      if (typeof params.archived !== 'boolean') throw new RpcError(INVALID_PARAMS, 'archived must be a boolean');
      const held = detached.get(handle);
      if (held === undefined || held.deleting) return {};
      held.archived = params.archived;
      if (held.archived) {
        await takeDown(handle, held, true);
        return {};
      }
      const port = options.worktrees;
      if (port === undefined || held.branch === undefined || await stat(held.path).then(() => true, () => false)) return {};
      await port.create({
        repository: held.repository,
        base: held.branch,
        path: held.path,
        ...(held.linked.length > 0 ? { symlink: held.linked } : {}),
      })
        .then(() => { log(`put ${held.path} back on ${held.branch ?? ''} for ${handle}`); })
        .catch((error: unknown) => { log.error(`could not put ${held.path} back: ${reason(error)}`); });
      return {};
    },
    /*
     * The window is done with the tree: it goes once nothing uses it, its
     * branch kept, and the handle with it, as VS Code's host queues the
     * removal. A tree in use, or one with work nobody committed, keeps its
     * handle, and each reconcile tries it again.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L418-L432
     */
    'vscode/deleteAgentHostDetachedWorktree': async (params) => {
      const handle = handleOf(params);
      const held = detached.get(handle);
      if (held === undefined) return {};
      held.deleting = true;
      if (await takeDown(handle, held, false)) detached.delete(handle);
      return {};
    },
    /*
     * The handles the window still holds, under the scope of one tree's
     * folder, as VS Code's host reconciles them: a handle it names is seen
     * again, and one it does not name is let go once the grace has passed,
     * its tree taken away when nothing uses it and nobody's work is in it,
     * and its handle kept until then. Each removal the window asked for that
     * is still owed is tried again, whatever the scope.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4069-L4084
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L805-L908
     */
    'vscode/reconcileAgentHostDetachedWorktrees': async (params) => {
      const { scope, activeHandles } = params;
      if (typeof scope !== 'string' || scope === '') throw new RpcError(INVALID_PARAMS, 'scope must be a non-empty string');
      if (!Array.isArray(activeHandles) || !activeHandles.every((one) => typeof one === 'string' && WORKTREE_HANDLE.test(one))) {
        throw new RpcError(INVALID_PARAMS, 'activeHandles must contain valid worktree handles');
      }
      const here = atPath(localPath(scope));
      const active = new Set<unknown>(activeHandles);
      const now = clock();
      for (const [handle, held] of [...detached]) {
        const inScope = atPath(held.path) === here;
        const named = !held.deleting && inScope && active.has(handle);
        if (named) held.lastSeenAt = now;
        const owed = held.deleting || held.archived;
        if (!owed && (named || !inScope || now - (held.claimed ? held.lastSeenAt : held.createdAt) < DETACHED_GRACE)) continue;
        if (await takeDown(handle, held, held.archived && !held.deleting) && !held.archived) detached.delete(handle);
      }
      return {};
    },
    /*
     * An artifact taken off a session, as the reference host takes one: the
     * params checked and refused in its words, the session restored first, a
     * session it cannot restore refused in its restore's words, and an id the
     * session does not hold left as it is.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3400-L3417
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3600-L3612
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2292-L2305
     */
    'vscode/removeSessionArtifact': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      const artifactId = stringParam(params, 'artifactId');
      if (artifactId.trim() === '') throw new RpcError(INVALID_PARAMS, 'artifactId must be a non-empty string');
      if (!URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      const parsed = new URL(session);
      if (!parsed.pathname.startsWith('/') || parsed.pathname.length < 2 || parsed.host !== ''
        || parsed.search !== '' || parsed.hash !== '' || spaceOf(session) === 'chat') {
        throw new RpcError(INVALID_PARAMS, 'session must be an Agent Session URI');
      }
      if (!sessions.has(session) && (ctx.unavailableProvider(idOf(session)) !== undefined
        || await ctx.restoreSession(idOf(session)) === undefined || ctx.nameOf(idOf(session)) !== session)) {
        throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${session}`);
      }
      const held = kept.artifacts(idOf(session)) ?? [];
      const left = held.filter((one) => one.id !== artifactId);
      if (left.length !== held.length) setArtifacts(session, left);
      return {};
    },
    /**
     * Stop a chat's background task.
     *
     * The two strings are checked here rather than in `background`: a request
     * that names no id, or something that is not a chat, is refusable on its
     * own terms, and answering `{ stopped: false }` for it would say the task
     * had already ended.
     *
     * Everything after that is one answer, `false`, because the client is not
     * told which of an unknown chat, an unknown id and a task with nothing to
     * stop it was - the reference host's own shape, and a client shows the
     * same thing after each.
     */
    'vscode/stopBackgroundWork': async (params) => {
      const chat = stringParam(params, 'chat', 'an AHP chat URI');
      const id = stringParam(params, 'id', 'a task id');
      // Each refusal in the reference host's words, in its order.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3432-L3444
      if (id.trim() === '') throw new RpcError(INVALID_PARAMS, 'id must be a non-empty string');
      if (!URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (spaceOf(chat) !== 'chat') throw new RpcError(INVALID_PARAMS, 'chat must be an Agent Host chat URI');
      return { stopped: await ctx.background.stop(chat, id) };
    },
    /**
     * The person's answer to a command's prompt, or their refusal with none.
     *
     * The strings are checked as the stop checks them; the answer itself is
     * handed straight to the helper and goes nowhere else. `delivered` is
     * `false` for a prompt that already ended, which is what the reference
     * host answers a request it no longer holds.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3865-L3886
     */
    'vscode/answerShellAuthentication': async (params) => {
      const chat = stringParam(params, 'chat', 'an AHP chat URI');
      const requestId = stringParam(params, 'requestId', 'a request id');
      const answer = optionalStringParam(params, 'answer');
      if (requestId.trim() === '') throw new RpcError(INVALID_PARAMS, 'requestId must be a non-empty string');
      if (!URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (spaceOf(chat) !== 'chat') throw new RpcError(INVALID_PARAMS, 'chat must be an Agent Host chat URI');
      return { delivered: ctx.shellAuth.answer(chat, requestId, answer) };
    },
    /**
     * Move a running call to the background: this host's own method, beside
     * the stop it mirrors, and the button a client draws for a call that
     * carries `ahpd.backgroundToolCall`.
     *
     * The strings are checked as the stop checks them, and everything after
     * is one answer, `false`: no offer, a call that already answered and a
     * move its provider could not make are the same to a client.
     */
    'x-ahpd/backgroundToolCall': async (params) => {
      const chat = stringParam(params, 'chat', 'an AHP chat URI');
      const toolCallId = stringParam(params, 'toolCallId', 'a tool call id');
      if (toolCallId.trim() === '') throw new RpcError(INVALID_PARAMS, 'toolCallId must be a non-empty string');
      if (!URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (spaceOf(chat) !== 'chat') throw new RpcError(INVALID_PARAMS, 'chat must be an Agent Host chat URI');
      return { backgrounded: await ctx.background.move(chat, toolCallId) };
    },
    /**
     * Where the backend's own record of a session is.
     *
     * The window's "open session state file", behind
     * `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`
     * since it names a chat as well as a session. A backend that writes
     * no such file answers no resource, which is the reference host's
     * answer too.
     */
    'vscode/getAgentHostSessionStateFile': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      const chat = optionalStringParam(params, 'chat', 'a URI string');
      const found = stateFileOf(session, chat);
      return found === undefined ? {} : { resource: uriOf(found) };
    },
    /**
     * The logs, packed up for a bug report.
     *
     * The host's own files under `agenthost/`, and the session's record
     * as `events.jsonl` when a session is named - the names the reference
     * host's collector gives them, so the window reads the result the
     * same. The archive is read back in chunks; the directory is opened
     * where it is.
     */
    /*
     * Followed under the client's progress token, as the reference host
     * follows a collection: a token already in use refused, `root/progress`
     * said as it goes and once more when it settles, marked as the debug
     * logs', and the collection called off by its client's cancel or when
     * that client goes.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4086-L4158
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16074-L16101
     */
    'vscode/collectAgentHostDebugLogs': async (params) => {
      const kind = params.kind;
      if (kind !== 'archive' && kind !== 'directory') throw new RpcError(INVALID_PARAMS, 'kind must be archive or directory');
      const session = optionalStringParam(params, 'session', 'a URI string');
      const chat = optionalStringParam(params, 'chat', 'a URI string');
      const token = optionalStringParam(params, 'progressToken');
      if (session !== undefined && !URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      if (chat !== undefined && !URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (chat !== undefined && session === undefined) throw new RpcError(INVALID_PARAMS, 'chat must belong to the requested Agent Session');
      // The session's backend's file first, then the host's own, the order the
      // reference collector takes them in.
      const record = session === undefined ? undefined : stateFileOf(session, chat);
      const owning = session === undefined ? undefined : (sessions.has(session) ? session : sessionFor(session));
      const provider = owning === undefined ? undefined : (sessions.get(owning)?.agent ?? owners.get(owning))?.provider;
      const files: LogFile[] = [
        ...(record !== undefined && provider !== undefined ? [{ path: 'events.jsonl', from: record, provider }] : []),
        ...(options.diagnostics?.logs?.() ?? []).map((file) => ({ path: hostLogPath(file), from: file })),
      ];
      const said = (progress: number, total: number | undefined, message?: string): void => {
        ctx.broadcast(ROOT, 'root/progress', {
          channel: ROOT, progressToken: token, progress,
          ...(total === undefined ? {} : { total }),
          ...(message === undefined ? {} : { message }),
          _meta: { 'vscode.debugLogs': true },
        });
      };
      let last = 0;
      try {
        return await logs.collect(files, kind, token === undefined ? undefined : {
          token,
          owner: connection.clientId,
          report: (bytes, total, message) => {
            last = bytes;
            said(bytes, total > 0 ? total : undefined, message);
          },
        });
      }
      finally {
        if (token !== undefined) said(last, last);
      }
    },
    /*
     * A collection called off by the client that follows it, in the reference
     * host's words for a token it does not follow.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4148-L4159
     */
    'vscode/cancelAgentHostDebugLogs': async (params) => {
      if (typeof params.progressToken !== 'string') throw new RpcError(INVALID_PARAMS, 'progressToken must be a string');
      if (!logs.cancel(params.progressToken, connection.clientId)) throw new RpcError(INVALID_PARAMS, 'Unknown debug-log collection');
      return {};
    },
    /*
     * One chunk of an artifact, the params refused in the reference host's
     * words and a failure of the read itself left as it is, which the wire
     * answers as an internal error.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4160-L4184
     */
    'vscode/readAgentHostDebugLogsChunk': async (params) => {
      const resource = params.resource;
      if (typeof resource !== 'string') throw new RpcError(INVALID_PARAMS, 'resource must be a URI string');
      if (!URL.canParse(resource)) throw new RpcError(INVALID_PARAMS, 'resource must be a valid URI string');
      const position = params.position;
      if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
        throw new RpcError(INVALID_PARAMS, 'position must be a non-negative integer');
      }
      return await logs.read(resource, position);
    },
    /*
     * A window's timing record, exported as a span while `diagnosticTiming` is
     * on.
     *
     * Off, the request is answered with nothing and no record is read. On, an
     * invalid record is refused in VS Code's words, and one whose provider or
     * request id is not an identifier is accepted with no span, which is what
     * the reference host answers an unusable join identifier with.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4319-L4329
     */
    'vscode/reportAgentHostFirstResponse': async (params) => {
      if (ctx.rootConfig.diagnosticTiming !== true) return {};
      const record = firstResponseRecord(params);
      if (record === undefined) throw new RpcError(INVALID_PARAMS, 'Invalid first-response diagnostic');
      const attributes = firstResponseAttributes(record);
      if (attributes !== undefined) ctx.clientSpan(AGENT_HOST_FIRST_RESPONSE_SPAN, attributes);
      return {};
    },
    /*
     * A window's user-interaction record, exported as a span while
     * `diagnosticTiming` is on, and flushed before the window is answered.
     *
     * Off, the request is answered with nothing and no record is read. On, a
     * record the validator accepts but that cannot describe an observation is
     * refused in the same words as one the validator refuses.
     * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4279-L4294
     */
    'vscode/reportChatUserInteraction': async (params) => {
      if (ctx.rootConfig.diagnosticTiming !== true) return {};
      const record = userInteractionRecord(params);
      const attributes = record === undefined ? undefined : userInteractionAttributes(record);
      if (attributes === undefined) throw new RpcError(INVALID_PARAMS, 'Invalid user interaction timing');
      ctx.clientSpan(USER_INTERACTION_SPAN, attributes);
      await ctx.flush();
      return {};
    },
    /**
     * The four the window asks of its own host about itself.
     *
     * `shutdown` closes the host, every backend stopped and every store
     * closed, then the debug logs, and answers once that is done, as the
     * reference host's shutdown shuts its providers down and answers after;
     * then, the answer gone, it runs the embedder's own end, which in the
     * daemon stops it the way `ahpd stop` does, as upstream decided. The
     * reference host's process stays up because the window that owns it ends
     * it, and a daemon has no window that owns it. The network diagnostics
     * are what the process can see - the proxy variables, and the endpoints
     * its backends name - and `diagnosticsFetch` tries one. Managed settings
     * answer an empty list, the host holding no managed policy layer.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16018-L16051
     */
    shutdown: async () => {
      await ctx.shutdown();
      await logs.close();
      const end = options.diagnostics?.shutdown;
      if (end !== undefined) {
        setTimeout(() => {
          Promise.resolve().then(end).catch((error: unknown) => {
            log.warn(`shutdown did not end the process: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, 0);
      }
      return {};
    },
    /*
     * The report as the reference host composes it: the backends' endpoints
     * once each by URL, the first account a backend is signed in as, and the
     * version where the daemon gave one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostProviderService.ts#L199-L233
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L65-L96
     */
    getNetworkDiagnosticsInfo: async () => {
      const proxyEnv: Record<string, string> = {};
      for (const key of PROXY_ENV) {
        const value = process.env[key];
        if (value) proxyEnv[key] = value;
      }
      const named = [...agents.values()].flatMap((agent) => agent.endpoints?.() ?? []);
      if (options.github !== undefined) named.push({ name: 'GitHub API', url: 'https://api.github.com/' });
      const seen = new Set<string>();
      const endpoints = named.filter((endpoint) => {
        const key = URL.canParse(endpoint.url) ? new URL(endpoint.url).toString() : endpoint.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const account = [...agents.values()].map((agent) => ctx.learned.get(agent.provider)?.account?.email).find((email) => email !== undefined && email !== '');
      const version = options.diagnostics?.version;
      return {
        ...(version === undefined ? {} : { version }),
        os: process.platform,
        arch: process.arch,
        ...(account === undefined ? {} : { account }),
        proxySettings: {},
        proxyEnv,
        endpoints,
      };
    },
    getManagedSettingsDiagnostics: async () => [],
    /*
     * One endpoint probed as the reference host probes it: a URL that does not
     * parse fails the request, and the result reports the proxy the probe goes
     * through. This process's fetch goes through the environment's proxy only
     * when Node is told to use it, and then through the one undici's
     * environment agent picks for the URL: NO_PROXY's entries match a host or
     * a domain under it, at a port where one is named.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L106-L155
     * https://github.com/nodejs/undici/blob/v8.10.2/lib/dispatcher/env-http-proxy-agent.js#L64-L160
     */
    diagnosticsFetch: async (params) => {
      const url = stringParam(params, 'url');
      const target = new URL(url);
      const [dnsIpv4, dnsIpv6] = await Promise.all([resolved(target.hostname, 4), resolved(target.hostname, 6)]);
      const viaEnvironment = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy');
      const http = process.env.http_proxy ?? process.env.HTTP_PROXY;
      const named = target.protocol === 'https:' ? process.env.https_proxy ?? process.env.HTTPS_PROXY ?? http : http;
      const bare = target.hostname.startsWith('[') ? target.hostname.slice(1, -1) : target.hostname;
      const host = (bare.length > 1 && bare.endsWith('.') ? bare.slice(0, -1) : bare).toLowerCase();
      const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
      const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
      const skipped = noProxy === '*' || noProxy.split(/[,\s]/).filter((entry) => entry !== '').some((entry) => {
        const bracketed = entry.startsWith('[') ? entry.indexOf(']:') : -1;
        const single = entry.indexOf(':') === entry.lastIndexOf(':') ? entry.lastIndexOf(':') : -1;
        const cut = bracketed > 0 ? bracketed + 1 : single;
        const digits = cut > 0 ? entry.slice(cut + 1) : '';
        const at = digits !== '' && [...digits].every((one) => one >= '0' && one <= '9') ? Number(digits) : 0;
        const raw = at > 0 ? entry.slice(0, cut) : entry;
        const unbracketed = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
        const dotless = unbracketed.startsWith('*.') ? unbracketed.slice(2) : unbracketed.startsWith('.') ? unbracketed.slice(1) : unbracketed;
        const name = (dotless.length > 1 && dotless.endsWith('.') ? dotless.slice(0, -1) : dotless).toLowerCase();
        return (at === 0 || at === port) && (host === name || host.endsWith(`.${name}`));
      });
      const proxyUrl = viaEnvironment && named !== undefined && named !== '' && !skipped ? named : undefined;
      const base = { url, ...(proxyUrl === undefined ? {} : { proxyUrl }), dnsIpv4, dnsIpv6 };
      const began = Date.now();
      try {
        const answer = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
        const body = await answer.text();
        return {
          ...base,
          statusCode: answer.status,
          body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
          durationMs: Date.now() - began,
        };
      }
      catch (error) {
        return { ...base, error: reason(error), durationMs: Date.now() - began };
      }
    },
    /*
     * The dev container surface, name for name.
     *
     * The reference client asks these four, and it reads the capability key
     * on `initialize` before it offers the flow at all, so the names and
     * the shapes are another program's on purpose. What crosses here is a
     * nested host's own frames: this host carries them and does not read
     * them, which is what makes the container the container's and not
     * this host's pretending to be there.
     */
    'vscode/devContainers/isDockerAvailable': async () =>
      need(options.containers, 'vscode/devContainers/isDockerAvailable').docker(),
    'vscode/devContainers/connect': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/connect');
      const one = containerAsk(params);
      return await startRelay(
        one,
        { name: one.name, folder: one.workspaceFolder },
        (sink, owner) => launcher.connect(owner === undefined ? one : { ...one, owner }, sink),
        async () => { await launcher.disconnect(one.connectionId); },
        () => vouchedFor(one.workspaceFolder, 'Workspace trust is required to start a Dev Container'),
      );
    },
    /*
     * An environment's container, made from an image the client chose.
     *
     * The reference client asks this to make an environment it named, and the
     * answer is a relay's, as a folder connect's is: there is no folder to
     * trust here, because the workspace is a volume the host makes. A launcher
     * without the method is refused as an absent launcher is.
     */
    'vscode/devContainers/connectEnvironment': async (params) => {
      const port = need(options.containers, 'vscode/devContainers/connectEnvironment');
      const connectEnvironment = port.connectEnvironment;
      if (connectEnvironment === undefined) {
        throw new RpcError(METHOD_NOT_FOUND, 'Method not found: vscode/devContainers/connectEnvironment');
      }
      const one = environmentAsk(params);
      return await startRelay(
        one,
        { name: one.name, environment: one.environmentId },
        (sink, owner) => connectEnvironment.call(port, owner === undefined ? one : { ...one, owner }, sink),
        async () => { await port.disconnect(one.connectionId); },
      );
    },
    /*
     * An environment removed with its volumes, and the owner it is checked
     * against taken from the connection the ask arrived on.
     *
     * The reference sends `{ environmentId }` and answers with whether the
     * removal acted; the sentence for another principal's environment is the
     * port's, because only a launcher knows whose an environment is.
     */
    'vscode/devContainers/removeEnvironment': async (params) => {
      const port = need(options.containers, 'vscode/devContainers/removeEnvironment');
      const remove = port.removeEnvironment;
      if (remove === undefined) {
        throw new RpcError(METHOD_NOT_FOUND, 'Method not found: vscode/devContainers/removeEnvironment');
      }
      const environmentId = typeof params.environmentId === 'string' ? params.environmentId : '';
      if (!isDevContainerEnvironmentId(environmentId)) {
        throw new RpcError(INVALID_PARAMS, 'environmentId must be a valid identifier');
      }
      return await remove.call(port, environmentId, ownerFor(connection));
    },
    'vscode/devContainers/disconnect': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/disconnect');
      const id = namedContainer(params);
      // A connection this client does not hold, in VS Code's words.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L151-L157
      if (!conn.containers.delete(id)) {
        throw new RpcError(-32008, 'Dev Container connection is not owned by this client');
      }
      // Nothing is notified: the client asked for this, and the reference
      // host's own client forgets the connection on its side as it does.
      await launcher.disconnect(id);
    },
    'vscode/devContainers/relaySend': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/relaySend');
      const id = namedContainer(params);
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L151-L157
      if (!conn.containers.has(id)) {
        throw new RpcError(-32008, 'Dev Container connection is not owned by this client');
      }
      const data = stringParam(params, 'data');
      // The frame is written and not read: the nested host is the one that
      // answers it, and what it answers with comes back as `relayMessage`.
      await launcher.send(id, data);
    },
    /*
     * The two the reference host sends when a dev container is idle or gone.
     *
     * Both take `{ workspaceFolder }` and answer a boolean, because a dev
     * container is a folder's here and not a connection's: the reference ends
     * the folder's relays, stops or removes the container, and answers `false`
     * while another client still uses it. This host answers the same, with one
     * more user than the reference has - a session placed on the folder's
     * computer, which after `container/03` is a machine ahpd sessions run in.
     */
    'vscode/devContainers/stop': async (params) => await devContainerStopped('stop', params),
    'vscode/devContainers/remove': async (params) => await devContainerStopped('remove', params),
  };
}