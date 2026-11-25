/**
 * A host that can run another host inside a container.
 *
 * The port is the launcher's whole surface: whether a container can be made at
 * all, making one for a workspace folder and starting a host inside it, writing
 * one frame to that host, and stopping the relay. What a frame *means* is not
 * here - the SDK owns the protocol, and this owns processes.
 *
 * A container is a workspace's own `devcontainer.json`, made by the Dev
 * Container CLI, so the port is a `devcontainer` client and not a Docker one:
 * Docker is what it reaches through, and the file is what it obeys. Decision
 * `a-dev-container-is-reached-by-docker-exec`.
 */

import type { Owner } from './usage.js';

/** What a client asks for: one connection, one folder, one name for it. */
export interface ContainerConnect {
  /**
   * The client's own name for this connection.
   *
   * Handed back with every frame and every close, so a client holding two
   * containers can tell them apart. It is not unique across clients: the host
   * keeps one map per connection, which is where the reference host puts it
   * too.
   */
  connectionId: string;
  /**
   * The folder whose `devcontainer.json` this is.
   *
   * An absolute path on this host. It is the container definition as well as
   * the folder a session inside it starts in.
   */
  workspaceFolder: string;
  /** What the client calls this container on screen. */
  name: string;
  /**
   * Whether a container that is stopped may be started again.
   *
   * A source is suspended when it is stopped, and a connect that does not say
   * `true` is refused in VS Code's words rather than silently starting a
   * container the client believed was down. Absent is not `true`.
   */
  resume?: boolean;
  /**
   * Whether the user's state is kept on a volume beside the workspace.
   *
   * The nested host's configuration and the agents' sessions are linked to a
   * second volume, so a container made again reaches the same state. Absent is
   * not `true`.
   */
  persistUserState?: boolean;
  /**
   * Whether the container runs with the options the command sandbox needs.
   *
   * The container's seccomp, AppArmor and system paths are unconfined, and
   * `/dev/net/tun` is a device in it. That weakens the container's own
   * isolation, so only an explicit `true` asks for it and an absent value does
   * not.
   */
  sandboxEnabled?: boolean;
  /**
   * Whose the container is, when the connection is somebody's.
   *
   * The client does not send it and is never asked: the host fills it from the
   * connection the relay was made on, because that is who owns what the
   * container runs.
   * Absent on a connection with nobody to name, and the container is then the
   * host's own.
   */
  owner?: Owner;
}

/**
 * The shape of an environment id.
 *
 * An environment is named by the client and never reused, and its id labels
 * the volume its workspace lives in, so it is held to one lowercase spelling.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/devContainerEnvironments.ts
 */
export const DEV_CONTAINER_ENVIRONMENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Whether a string is an environment id this host makes a container for. */
export const isDevContainerEnvironmentId = (id: string): boolean => DEV_CONTAINER_ENVIRONMENT_ID.test(id);

/**
 * The images an environment may be made from, which is the reference's list.
 *
 * A client sends an image because it chose one, and a host that took any image
 * would pull whatever a window named.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/devContainerEnvironments.ts
 */
export const DEV_CONTAINER_ENVIRONMENT_IMAGES: readonly string[] = ['mcr.microsoft.com/devcontainers/base:ubuntu'];

/**
 * What a client asks for: one connection to an environment made from an image.
 *
 * An environment is not a folder's `devcontainer.json`: its workspace is a
 * Docker volume this host names, so there is no definition on this host to
 * read and the image is the whole of what the client chooses.
 */
export interface ContainerEnvironmentConnect {
  /** The client's own name for this connection, as in `ContainerConnect`. */
  connectionId: string;
  /** The environment's id, which labels its volume and is never reused. */
  environmentId: string;
  /** The image to make it from, one of `DEV_CONTAINER_ENVIRONMENT_IMAGES`. */
  image: string;
  /** What the client calls this environment on screen. */
  name: string;
  /** Whether a container that is stopped may be started again, as `ContainerConnect`'s is. */
  resume?: boolean;
  /** Whether the user's state is kept on a volume, as `ContainerConnect`'s is. */
  persistUserState?: boolean;
  /** Whether the container runs with the sandbox's options, as `ContainerConnect`'s is. */
  sandboxEnabled?: boolean;
  /** Whose the environment is, filled from the connection as `ContainerConnect`'s is. */
  owner?: Owner;
}

/** The point of a connect a user state report is about. */
export type ContainerUserStateStage = 'mount' | 'up' | 'link' | 'userCommands';

/**
 * One stage of a connect that keeps the user's state, as the reference reports
 * it.
 *
 * `mount` says whether a state volume was added or the container already had
 * one; `up` and `userCommands` say whether the CLI stage succeeded; `link` says
 * what became of the folders and carries their counts. The fields are VS
 * Code's, so a client reads them the same way.
 * https://github.com/microsoft/vscode/blob/ddbdd50a9ed1/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts
 */
export interface ContainerUserState {
  /** The stage this report is about. */
  stage: ContainerUserStateStage;
  /**
   * What happened at that stage.
   *
   * `mount`: `added`, `existingContainer` or `failed`.
   * `up` and `userCommands`: `succeeded` or `failed`.
   * `link`: `linked`, `homeNotFound`, `noMount` or `failed`.
   */
  outcome: string;
  /** Which step failed, when the outcome is `failed`. */
  reason?: string;
  /** The link script's last step, when it failed. */
  step?: string;
  /** The exit code of the stage's command, when it has one. */
  exitCode?: number;
  /** Where the state volume is, classed as its mount target. */
  target?: 'workspaces' | 'volume';
  /** Folders whose state from an earlier container replaced the container's own folder. */
  restoredFolders?: number;
  /** Folders moved from the container to the state volume. */
  movedFolders?: number;
  /** Folders made on both sides and linked. */
  createdFolders?: number;
  /** Folders that were already linked. */
  existingFolders?: number;
  /** Folders that were not linked. */
  skippedFolders?: number;
  /** The sorted, comma-separated reasons the folders were not linked. */
  skipReasons?: string;
  /** The stage's own sentence, when it failed. */
  errorMessage?: string;
}

/** What a client is told once the container is up and a host is running in it. */
export interface ContainerConnectResult {
  /**
   * Where the nested host is, as a name a client shows and stores.
   *
   * `devcontainer:<containerId>`, which is the reference's own spelling. It is
   * not something a client can dial: the frames arrive through this host.
   */
  address: string;
  /** The workspace folder as the container sees it. */
  remoteWorkspaceFolder: string;
  /** The same folder as this host knows it, when the launcher knows it. */
  hostWorkspaceFolder?: string;
  /**
   * Whether the running container has the options the command sandbox needs.
   *
   * Read from the container itself rather than from what the connect asked
   * for: a container made earlier keeps the settings it was made with.
   */
  sandboxSupported: boolean;
}

/**
 * What a port says while a container comes up and while it runs.
 *
 * Given to `connect` rather than returned by it, because a container says
 * things before it is ready: the CLI prints what it is doing, and a person
 * waiting for an image to build should see it.
 */
export interface ContainerSink {
  /** One frame from the host inside the container, exactly as it wrote it. */
  message(text: string): void;
  /** The launcher's or the nested host's own output, for a person watching. */
  output(text: string): void;
  /**
   * One stage of a connect that keeps the user's state.
   *
   * Optional, because a sink that does not report a connect's stages is not
   * asked to: the host's own sink forwards it as a notification.
   */
  userState?(notice: ContainerUserState): void;
  /**
   * Whether the running container has the options the command sandbox needs.
   *
   * Optional, as `userState` is: a sink that does not report a connect's facts
   * is not asked to.
   */
  sandboxSupport?(supported: boolean): void;
  /** The relay ended. The reason is absent when it was simply stopped. */
  close(reason?: string): void;
}

/**
 * A launcher for containers, as a host option or a plugin's contribution.
 *
 * Every member is a promise or a plain answer, and none of them throws for a
 * state a client can be told about: a container that cannot be made is a
 * refusal with a sentence, which is what the caller reports.
 */
export interface ContainerPort {
  /**
   * Whether Docker can be resolved from this host's environment.
   *
   * The question the reference client asks by that name, and nothing more: the
   * CLI is a second fact, and answering both here would make a host with Docker
   * look like a host with no Docker at all.
   */
  docker(): Promise<boolean>;
  /**
   * Whether a container can be made here at all.
   *
   * Both facts: Docker resolves, and the Dev Container CLI does. This is what
   * the capability key follows, so a host that has Docker and not the CLI
   * advertises nothing and is never asked to make one.
   */
  available(): Promise<boolean>;
  /**
   * Make or find the container for a folder, and start a host inside it.
   *
   * Answers once the host is running and the channel is open; everything it
   * said on the way, and everything the host says afterwards, arrives on
   * `sink` until `close`. A failure is a refusal with a sentence, and nothing
   * is left running when it throws.
   */
  connect(options: ContainerConnect, sink: ContainerSink): Promise<ContainerConnectResult>;
  /**
   * Make or find an environment's container, and start a host inside it.
   *
   * The environment's workspace is a Docker volume this host names and labels,
   * so the container outlives it and a second connect reaches the same one.
   * What is answered and what arrives on `sink` are `connect`'s.
   *
   * Optional, because a launcher that knows only folders serves no such
   * method, and a client that asks is refused the way it is for an absent
   * launcher.
   */
  connectEnvironment?(options: ContainerEnvironmentConnect, sink: ContainerSink): Promise<ContainerConnectResult>;
  /**
   * Remove an environment: its containers, its volumes and its cached
   * configuration, and answer whether it acted.
   *
   * `vscode/devContainers/removeEnvironment`. Unlike a folder's `remove`, the
   * workspace is this host's own volume, so it goes with the container and
   * nothing of the environment is left behind. The owner is the principal the
   * removing connection belongs to: on a host with users, only the principal
   * that made an environment may remove it, and another's attempt is refused
   * with a sentence rather than answered `false`.
   *
   * Optional, because a launcher that knows only folders serves no such
   * method, and a client that asks is refused the way it is for an absent
   * launcher.
   */
  removeEnvironment?(environmentId: string, owner?: Owner): Promise<boolean>;
  /** Write one frame to the host inside this connection's container. */
  send(connectionId: string, data: string): void | Promise<void>;
  /**
   * Stop one connection's relay: end the host, release the channel.
   *
   * The container itself is the CLI's to keep, as it is in the reference host:
   * what ends here is the relay, which is this host's own process.
   */
  disconnect(connectionId: string): void | Promise<void>;
  /**
   * Stop the container a folder's dev container is, and answer whether it acted.
   *
   * `vscode/devContainers/stop` in the reference client's own name for it: the
   * folder is the whole of what it names, because a dev container is a folder's
   * `devcontainer.json` made into a machine. The container stops and the folder
   * and its `devcontainer.json` stay, as they do for a `computer://` stop.
   *
   * `true` is "nothing of this folder's is running now" and is what a folder
   * with no container of its own answers: a client asking for one that is
   * already gone has nothing left to want. `false` is "it is still in use",
   * which the reference host answers and its caller reports unchanged.
   *
   * Optional, because a launcher that cannot reach the runtime's own `stop`
   * serves no such method, and a client that asks is refused the way it is for
   * an absent launcher.
   */
  stop?(folder: string): Promise<boolean>;
  /**
   * Remove the container a folder's dev container is, and answer whether it acted.
   *
   * `vscode/devContainers/remove`: the container goes and the folder and its
   * `devcontainer.json` never do, because the definition is the folder's and the
   * container is this host's. `true` and `false` are `stop`'s.
   */
  remove?(folder: string): Promise<boolean>;
  /**
   * Stop every relay this launcher started, and answer once they have ended.
   *
   * The daemon's own stop. A nested host left running is a process nobody is
   * talking to and a container still holding pipes, so a launcher that started
   * one ends it here rather than leaving it for the rest of the process's life. The containers
   * themselves stay, as they do for `disconnect`: what ends is the relay.
   *
   * Optional, because a launcher with no process of its own has nothing to
   * end, and a caller that never closes one still stops the daemon.
   */
  close?(): Promise<void>;
}
