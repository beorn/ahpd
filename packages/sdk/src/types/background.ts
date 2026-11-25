/**
 * A background task a backend reports, and the seam it reports it through.
 *
 * The backend is the only thing that sees its harness's tasks, and the host is
 * the only thing that knows what a chat row says and how it reaches a client -
 * so the backend brings the words and the host draws the row. That is why this
 * is not the protocol's `BackgroundWork`: nothing here is a URI the host has
 * not minted, and a task is something a backend says rather than something a
 * client reads.
 */

/** What kind of work a task is. */
export type BackgroundTaskKind = 'shell' | 'subagent';

/**
 * One task, as a backend knows it.
 *
 * `id` is the backend's own, opaque to everybody else, and unique within the
 * chat across both kinds. The host turns it into the row a client upserts by,
 * so a task that reports the same id twice is the same row twice rather than
 * two rows.
 */
export interface BackgroundTask {
  /** Unique within the chat, across kinds. Opaque to clients. */
  id: string;
  /** A shell command still running, or a subagent. */
  kind: BackgroundTaskKind;
  /** What a client draws: the command's purpose, or the subagent's name. */
  label: string;
  /** ISO 8601, when the work started. */
  startedAt: string;
  /** A shell's command line. */
  command?: string;
  /** A subagent's chat. */
  chat?: string;
  /** The terminal carrying a shell's output, once the host has one. */
  terminal?: string;
  /**
   * How the host stops this task, when it can.
   *
   * Present is what a client is told as the row's flag, and the answer is
   * whether live work was actually stopped: the task may have ended on its
   * own between the row being sent and the button being pressed.
   */
  stop?: () => Promise<boolean>;
}

/**
 * The seam a backend reports through, handed on `Start`.
 *
 * `set` is an upsert: the same id twice replaces the row. `remove` names a
 * task that has ended, and an id the host never had is a no-op - the protocol's
 * own convention, which is what lets a backend report removals without
 * tracking what the host kept.
 */
export interface BackgroundTasks {
  /** Report a task, or report a running one again. */
  set(chat: string, task: BackgroundTask): void;
  /** Report that a task has ended. */
  remove(chat: string, id: string): void;
}

/**
 * One chat's half of the seam, for a host tool that draws its own row.
 *
 * A tool runs where it runs: it sets a row on the chat of its call and takes
 * it back there, and it never names another chat. The host binds the chat, so
 * the same report a backend makes through `BackgroundTasks` reaches a tool
 * without letting it draw a row somewhere it does not run.
 */
export interface ChatBackgroundTasks {
  /** Report a task on the calling chat, or report a running one again. */
  set(task: BackgroundTask): void;
  /** Report that a task on the calling chat has ended. */
  remove(id: string): void;
}

/**
 * How a running call goes on in the background, answering whether it did:
 * `false` when the call had already answered or its work could not be let go.
 *
 * A move that works reports the row through `moved` before the call
 * completes, because the completion is where the host writes the row's id on
 * the call, and a completion that came first would name no row.
 */
export type MoveToBackground = () => Promise<boolean>;

/**
 * The running calls a provider can move to the background, and the calls
 * whose work already runs there.
 *
 * The provider is the one who runs the call - a backend for the agent's own
 * tools, a host tool for its own - so it is the one that knows how to answer
 * the call early and keep its work going. The host is the one that knows what
 * a client reads, so the provider reports and the host writes the call's
 * `_meta`: `ahpd.backgroundToolCall: true` while an offer stands, and
 * `ahpd.backgroundWork`, the row's id, once the work runs in the background.
 * The first goes when the call completes; the second stays on it.
 *
 * Every id is the call's own, as its `chat/toolCallStart` carried it, on the
 * chat that holds the call. An id the host has no record of is a no-op.
 */
export interface MovableCalls {
  /** Offer a running call to move. A second offer replaces the first. */
  offer(chat: string, toolCallId: string, move: MoveToBackground): void;
  /** Take an offer back: the call ended, or can no longer move. */
  withdraw(chat: string, toolCallId: string): void;
  /**
   * Report that a call's work runs in the background as the row `row`,
   * whoever moved it: a move, the model asking from the start, or a client
   * letting it go in a way of its own. Any offer for the call is taken back.
   * Reported before the call completes, so its completion names the row.
   */
  moved(chat: string, toolCallId: string, row: string): void;
}

/**
 * One call's half of the seam, for a host tool.
 *
 * The host binds the chat and the call, as it binds the chat for
 * `ChatBackgroundTasks`: a tool offers the call it is running and no other.
 * A call the backend named no id for has nothing a client could name back,
 * so each verb is a no-op there.
 */
export interface CallMovable {
  /** Offer this call to move. */
  offer(move: MoveToBackground): void;
  /** Take this call's offer back. */
  withdraw(): void;
  /** Report that this call's work runs in the background as the row `row`. */
  moved(row: string): void;
}
