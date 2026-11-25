import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import { posix } from '../../../tools/posix.ts';
import { uriOf } from '../src/resources/fileuri.js';
import { ROOT } from '../src/host.js';
import type { Host } from '../src/types/host.js';
import {
  resetSdk, claude, createHost, fileResources, gitBranches, hello, hostTools, peer, sessionQueries, settle, shellTerminals,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A command of the agent terminal tool that a person moves to the background
 * while its call waits for it.
 *
 * The call is offered while it runs, `x-ahpd/backgroundToolCall` lets the
 * command go on, and from there it is an `async` command: a row with a stop,
 * the shell held until it ends, and a turn at its end. A client narrowing the
 * terminal's claim, VS Code's own let-go, ends the same way.
 */

type Answer = { content: { text: string }[]; isError?: boolean };
type Handler = (input: unknown, extra?: unknown) => Promise<Answer>;
type Turn = { message?: { text?: string } };
type ChatState = { backgroundWork?: Record<string, unknown>[]; turns?: Turn[]; activeTurn?: Turn };
type Row = { resource: string; claim: { session?: string; chat?: string; toolCallId?: string } };

const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

const until = async (check: () => Promise<boolean> | boolean, what = 'it'): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (await check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`${what} never happened`);
};

/** A host with the terminal tool on and one Claude session, whose host tools a case calls by handler. */
const hosted = async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-shell-move-')));
  const host = createHost({
    path: dir,
    agents: [claude({ paths: [dir] })],
    resources: fileResources(),
    directories: gitBranches(),
    terminals: shellTerminals(),
    tools: hostTools(),
  });
  opened.push(host);
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
  await client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { enableCustomTerminalTool: true } } },
  });
  await settle();
  const uri = 'ahp-session:/shell-move';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(dir)] } });
  const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  const chatState = async (): Promise<ChatState> => (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: ChatState };
  }).snapshot.state;
  await chatState();
  const call = async (name: string, input: Record<string, unknown>, id: string): Promise<Answer> => {
    const options = sessionQueries().at(-1)?.options as Record<string, unknown>;
    const servers = options.mcpServers as Record<string, { tools: { name: string; handler: Handler }[] }>;
    const found = servers.host?.tools.find((one) => one.name === name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    return await found.handler(input, { _meta: { 'claudecode/toolUseId': id } });
  };
  const move = async (toolCallId: string): Promise<unknown> =>
    await client.handle({ method: 'x-ahpd/backgroundToolCall', params: { chat: chatUri, toolCallId } });
  const terminals = async (): Promise<Row[]> => (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { terminals?: Row[] } };
  }).snapshot.state.terminals ?? [];
  return { client, chatUri, chatState, call, move, terminals };
};

const text = (answer: Answer): string => answer.content.map((one) => one.text).join('');

const shellIdOf = (answer: Answer): string => /^Shell ID: (\S+)\n/u.exec(text(answer))?.[1] ?? '';

/** The text of the turn a command's end began, once there is one. */
const endTurn = async (on: Awaited<ReturnType<typeof hosted>>): Promise<string> => {
  const texts = async (): Promise<string[]> => {
    const state = await on.chatState();
    return [...(state.turns ?? []), ...(state.activeTurn === undefined ? [] : [state.activeTurn])].map((one) => String(one.message?.text ?? ''));
  };
  await until(async () => (await texts()).some((one) => one.startsWith('The background shell command ended')), 'the turn at the end');
  return (await texts()).find((one) => one.startsWith('The background shell command ended')) ?? '';
};

describe.skipIf(!posix)('a waited-for command moved to the background', () => {
  it('answers its call at once, runs as a row, and wakes the chat with its end', async () => {
    const on = await hosted();
    const running = on.call('bash', { command: 'sleep 1; echo finished', timeout: 30_000 }, 'tc-move');
    await until(async () => (await on.terminals()).length === 1, 'the shell');
    expect(await on.move('tc-move')).toEqual({ backgrounded: true });
    const answer = await running;
    expect(answer.isError).toBeUndefined();
    expect(text(answer)).toMatch(/^Shell ID: \S+\nThe user chose to continue this command in the background\. The terminal is still running\.$/u);
    const id = shellIdOf(answer);
    const [row] = (await on.chatState()).backgroundWork ?? [];
    expect(row).toMatchObject({ id: `shell:${id}`, kind: 'shell', label: 'sleep 1; echo finished', command: 'sleep 1; echo finished' });
    expect((row?._meta as Record<string, unknown> | undefined)?.['vscode.stopBackgroundWork']).toBe(true);
    const said = await endTurn(on);
    expect(said).toContain('The background shell command ended with exit code 0.');
    expect(said).toContain('finished');
    expect((await on.chatState()).backgroundWork ?? []).toEqual([]);
  });

  it('answers false once the call has answered, and moves nothing', async () => {
    const on = await hosted();
    await on.call('bash', { command: 'echo quick' }, 'tc-quick');
    expect(await on.move('tc-quick')).toEqual({ backgrounded: false });
    expect((await on.chatState()).backgroundWork ?? []).toEqual([]);
  });

  it('goes the same way when a client narrows the claim instead', async () => {
    const on = await hosted();
    const running = on.call('bash', { command: 'sleep 1; echo narrowed', timeout: 30_000 }, 'tc-narrow');
    await until(async () => (await on.terminals()).length === 1, 'the shell');
    const [terminal] = await on.terminals();
    await on.client.handle({
      method: 'dispatchAction',
      params: {
        channel: terminal?.resource,
        action: { type: 'terminal/claimed', claim: { kind: 'session', session: terminal?.claim.session, chat: terminal?.claim.chat } },
      },
    });
    const answer = await running;
    expect(text(answer)).toMatch(/The user chose to continue this command in the background/u);
    expect(((await on.chatState()).backgroundWork ?? []).map((one) => one.id)).toEqual([`shell:${shellIdOf(answer)}`]);
    // The move has nothing left to move.
    expect(await on.move('tc-narrow')).toEqual({ backgrounded: false });
    expect(await endTurn(on)).toContain('narrowed');
  });
});
