/**
 * The operations that the channels plugins registered offer, while the daemon runs.
 *
 * A fold says which channels there are, and a plugin that is closing offers
 * nothing from before its closers run. The set still holds that plugin until
 * its last closer is done, so a fold made in between lists its channel again;
 * a channel that closed stays out of every fold after. A plugin applied again
 * registers a new channel, which is offered from the next fold.
 */

import { pluginOperationChannels } from '@ahpd/sdk';
import type { Contribution, HostOptions, OperationChannel, PluginChannel } from '@ahpd/sdk';

/** The registered channels' operations of one daemon. */
export interface ChannelOperations {
  /** The channels that offer operations now, by URI. */
  channels(): Record<string, OperationChannel>;
  /** Offer what this fold's channels do. */
  serve(channels: HostOptions['channels']): void;
  /** Offer nothing more from the channels of a plugin that is about to close. */
  close(contribution: Contribution | undefined): void;
}

export const channelOperations = (onProblem: (message: string) => void): ChannelOperations => {
  const closed = new WeakSet<PluginChannel>();
  let folded: HostOptions['channels'];
  let offered: Record<string, OperationChannel> = {};
  const serve = (channels: HostOptions['channels']): void => {
    folded = channels;
    const open = Object.entries(channels ?? {}).filter(([, one]) => !closed.has(one.channel));
    offered = pluginOperationChannels(Object.fromEntries(open), onProblem);
  };
  return {
    channels: () => offered,
    serve,
    close: (contribution) => {
      for (const one of Object.values(contribution?.channels ?? {})) closed.add(one.channel);
      serve(folded);
    },
  };
};
