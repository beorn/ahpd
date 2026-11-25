import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { localPath } from '../resources/fileuri.js';
import { ownerOfPrincipal } from '../utils/values.js';
import type { Principal } from '../types/users.js';

/**
 * A workspace a client asks a chat to work in.
 *
 * The three shapes are VS Code's `IAgentCreateChatWorkspace`: a scratch folder
 * this host makes, a folder the chat works in directly, and a folder a new
 * worktree of the chat is cut from. A worktree's `prompt` is the chat's first
 * turn, and its `baseBranch` is what the tree is cut from.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts#L18-L22
 */
export type ChatWorkspace =
  | { kind: 'scratch' }
  | { kind: 'folder'; folder: string; isolation: 'folder' }
  | { kind: 'folder'; folder: string; isolation: 'worktree'; baseBranch?: string; prompt: string };

/** The `createChat` `_meta` key carrying the workspace a client asks for. */
export const CHAT_WORKSPACE_META = 'vscode.chatWorkspace';

const isBag = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A folder as an absolute path, or nothing for a value that is not an absolute
 * `file:` URI.
 *
 * The URI is parsed by the platform's own reader, so `file:/tmp` and
 * `file:///tmp` are one folder and `file:tmp` is none, and then read as a path
 * by this host's one reader, so an encoded space is a space again.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts#L48-L57
 */
const folderOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.slice(0, 5).toLowerCase() !== 'file:') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  }
  catch {
    return undefined;
  }
  if (parsed.protocol !== 'file:' || !parsed.pathname.startsWith('/')) return undefined;
  const at = value.indexOf(':');
  const path = localPath(value.startsWith('file://') ? value : `file://${value.slice(at + 1)}`);
  return path !== '' && isAbsolute(path) ? path : undefined;
};

/**
 * The workspace a client asked for, `'invalid'` for a value that is present
 * and malformed, or nothing where it asked for none.
 *
 * A folder that is not an absolute `file:` URI is malformed, and so is a base
 * branch that is blank or looks like an option.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/meta/vscode/agentHostCreateChatWorkspaceMeta.ts#L40-L66
 */
export const readChatWorkspaceValue = (value: unknown): ChatWorkspace | 'invalid' => {
  if (!isBag(value)) return 'invalid';
  if (value.kind === 'scratch') return { kind: 'scratch' };
  if (value.kind !== 'folder') return 'invalid';
  const folder = folderOf(value.folder);
  if (folder === undefined) return 'invalid';
  if (value.isolation === 'folder') return { kind: 'folder', folder, isolation: 'folder' };
  if (value.isolation !== 'worktree' || typeof value.prompt !== 'string') return 'invalid';
  const baseBranch = value.baseBranch;
  if (baseBranch !== undefined && (typeof baseBranch !== 'string' || !baseBranch.trim() || baseBranch.startsWith('-'))) return 'invalid';
  return {
    kind: 'folder',
    folder,
    isolation: 'worktree',
    ...(baseBranch === undefined ? {} : { baseBranch }),
    prompt: value.prompt,
  };
};

/** The workspace a `createChat` request carries, if any. */
export const readCreateChatWorkspaceMeta = (
  meta: Readonly<Record<string, unknown>> | undefined,
): ChatWorkspace | undefined | 'invalid' => {
  const value = meta?.[CHAT_WORKSPACE_META];
  return value === undefined ? undefined : readChatWorkspaceValue(value);
};

/** The folder chat scratch folders are made under, `~/.copilot/chats`. */
export const chatScratchRoot = (): string => resolve(homedir(), '.copilot', 'chats');

/**
 * A scratch folder of a chat's own, made now: `<chats>/<fresh id>`.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L7181
 */
export const newChatScratchFolder = async (): Promise<string> => {
  const folder = join(chatScratchRoot(), randomUUID());
  await mkdir(folder, { recursive: true });
  return folder;
};

/** A scratch folder made for a chat, removed where its move did not complete. */
export const removeChatScratchFolder = async (folder: string): Promise<void> => {
  await rm(folder, { recursive: true, force: true });
};

/**
 * The scratch folder `folder` is or is inside, if any.
 *
 * Every folder directly under the chats root is a scratch folder: a session's
 * own and a chat's own are both made there, and neither is a folder a chat may
 * be given as its workspace.
 */
const scratchFolderOf = (folder: string): string | undefined => {
  const root = chatScratchRoot();
  const inside = relative(root, resolve(folder));
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return undefined;
  return join(root, inside.split(sep)[0] as string);
};

/**
 * Refuses a folder that is, or is inside, a chat's own scratch folder.
 *
 * A scratch folder belongs to one chat, so no other chat may adopt it, or a
 * folder inside it, as its workspace.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentService.ts#L7210-L7237
 */
export const requireNonScratchChatFolder = (folder: string): void => {
  const scratch = scratchFolderOf(folder);
  if (scratch === undefined) return;
  if (resolve(folder) === resolve(scratch))
    throw new RpcError(INVALID_PARAMS, `'${folder}' is a chat's own scratch folder; pick No Workspace for a scratch folder of its own.`);
  throw new RpcError(INVALID_PARAMS, `'${folder}' is inside '${scratch}', a chat's own scratch folder; pick No Workspace for a scratch folder of its own.`);
};

/**
 * Whether `folder` is a scratch folder: one directly under the chats root.
 *
 * A session's own and a chat's own are both made there, so this answers the
 * shape alone; the caller decides which of the two it may remove.
 */
export const isChatScratchFolder = (folder: string): boolean => {
  const scratch = scratchFolderOf(folder);
  return scratch !== undefined && resolve(folder) === resolve(scratch);
};

/** What this host knows of an existing chat a client asks to give a workspace to, read before the move. */
export interface ChatForWorkspace {
  /** Whether it is its session's default chat. */
  defaultChat: boolean;
  /** What made it: `user` for a chat a person made, else the source that did. */
  origin: string;
  /** Whether it holds a turn, a queued message or a steering message. */
  started: boolean;
  /** The provider of the agent it runs on, and whether that agent keeps a folder per chat. */
  provider: string;
  folderPerChat: boolean;
}

/**
 * Refuses a chat that cannot be given a workspace now.
 *
 * A session's default chat has the session's workspace and no other, and a
 * chat a person did not make - a fork, a side chat, a tool's - is not one a
 * client may move. A chat whose agent keeps no folder per chat has nowhere of
 * its own to be given, and one that has started has a turn that would run in
 * the wrong folder.
 */
export const requireChatForWorkspace = (chat: ChatForWorkspace): void => {
  if (chat.defaultChat) throw new RpcError(INVALID_PARAMS, 'The default chat cannot get a workspace of its own.');
  if (chat.origin !== 'user') throw new RpcError(INVALID_PARAMS, 'Only a chat a person made can be given a workspace.');
  if (!chat.folderPerChat) throw new RpcError(INVALID_PARAMS, `The agent ${chat.provider} does not support a workspace per chat.`);
  if (chat.started) throw new RpcError(INVALID_PARAMS, 'A chat that has started cannot be given a workspace.');
};

/** Whose session a chat is, and who asks to give it a workspace. */
export interface WorkspaceCaller {
  /** The owner the chat's session is kept under, `user:<id>` or `plugin:<name>`, if it has one. */
  owner: string | undefined;
  /** The principal the connection signed in as, or nothing on a host with no people directory. */
  principal: Principal | undefined;
  /** Whether the caller is the host's own root connection, which is refused nothing. */
  root: boolean;
}

/**
 * Refuses a chat whose session is another's.
 *
 * A workspace move changes where a chat runs, asks the calling window about
 * the folder's trust and gives up the folder the chat leaves, so it is a
 * change to the session as well as to the chat, and the same act `mayDispose`
 * refuses another person: the session's owner may make it, and so may a role
 * holding the whole of `session:*`.
 */
export const requireWorkspaceAuthority = (caller: WorkspaceCaller): void => {
  if (caller.principal === undefined || caller.root) return;
  if (caller.owner === ownerOfPrincipal(caller.principal)) return;
  if (caller.principal.can('session:*')) return;
  throw new RpcError(-32009, "Only the session's owner can give its chats a workspace.");
};
