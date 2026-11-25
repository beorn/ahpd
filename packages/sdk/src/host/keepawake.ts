/**
 * The host's hold on the machine's idle sleep while a chat works, VS Code's
 * `AgentHostKeepAwake`.
 *
 * The host decides when to hold, from the count of sessions running a turn
 * and the root key `keepAwakeWhileWorking`; the daemon brings the helper that
 * holds, as VS Code's host is handed its `acquire`. The hold is let go 2
 * minutes after the last turn ends, so a pause between turns keeps it.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/node/agentHostKeepAwake.ts
 */

/** The root key that says when the host keeps its machine awake. */
export const KEEP_AWAKE_KEY = 'keepAwakeWhileWorking';
/** `never`, `always`, or `whenPluggedIn`, the default. */
export type KeepAwakeMode = 'never' | 'always' | 'whenPluggedIn';
/** How long the hold stays after the last turn ends, VS Code's `RELEASE_DELAY`. */
export const KEEP_AWAKE_RELEASE_DELAY = 2 * 60 * 1000;

/** One hold on idle sleep, let go by `release`. */
export interface KeepAwakeHold {
  release(): void;
}
/** Takes a hold; `allowOnBattery` is false for `whenPluggedIn`, which holds only on mains power. */
export type AcquireKeepAwake = (allowOnBattery: boolean) => KeepAwakeHold;

/** The key's value, `whenPluggedIn` for anything else. */
export const keepAwakeModeOf = (value: unknown): KeepAwakeMode => (value === 'never' || value === 'always' ? value : 'whenPluggedIn');

/**
 * The policy: `update` is called when the count of running sessions or the
 * key may have moved, and `stop` lets go at once.
 */
export const createKeepAwake = (
  acquire: AcquireKeepAwake | undefined, key: () => unknown, running: () => boolean, delay = KEEP_AWAKE_RELEASE_DELAY,
): { update(): void; stop(): void } => {
  if (acquire === undefined) return { update: () => {}, stop: () => {} };
  let hold: KeepAwakeHold | undefined;
  let release: ReturnType<typeof setTimeout> | undefined;
  let mode: KeepAwakeMode | undefined;
  const cancel = (): void => {
    if (release !== undefined) clearTimeout(release);
    release = undefined;
  };
  const clear = (): void => {
    hold?.release();
    hold = undefined;
  };
  return {
    update: () => {
      const now = keepAwakeModeOf(key());
      // A new mode takes a new hold, so `never` lets go at once and `always` holds on battery.
      if (now !== mode) {
        cancel();
        clear();
        mode = now;
      }
      if (now !== 'never' && running()) {
        cancel();
        hold ??= acquire(now === 'always');
      } else if (hold !== undefined && release === undefined) {
        release = setTimeout(() => { release = undefined; clear(); }, delay);
        release.unref?.();
      }
    },
    stop: () => {
      cancel();
      clear();
    },
  };
};
