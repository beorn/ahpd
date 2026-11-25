import { expect, it } from 'vitest';
import { hello, host, watching } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';

/*
 * A window's timing records.
 *
 * Two of VS Code's own extension methods, offered only while the root setting
 * `diagnosticTiming` is on, and each exported as the zero-duration metadata
 * span the reference host emits: an observation, not work this host did.
 */

/** A root config store holding one value, read when the host is built. */
const setting = (on: boolean) => ({
  read: () => ({ diagnosticTiming: on }),
  write: () => {},
});

/** The `_meta` an initialize answered. */
const metaOf = (answer: unknown): Record<string, unknown> =>
  ((answer as { _meta?: Record<string, unknown> })._meta ?? {});

/** Every span exported on the traces channel so far. */
const spans = (p: ReturnType<typeof watching>): Bag[] => p.seen
  .filter((one) => one.method === 'otlp/exportTraces')
  .flatMap((one) => (one.params as {
    payload: { resourceSpans: { scopeSpans: { spans: Bag[] }[] }[] };
  }).payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? []);

/** One span's attributes as key and value, whichever kind the wire carried. */
const attributesOf = (span: Bag): Record<string, unknown> => Object.fromEntries(
  (span.attributes as { key: string; value: Bag }[])
    .map((one) => [one.key, one.value.stringValue ?? one.value.doubleValue ?? one.value.boolValue]),
);

const FIRST_RESPONSE = {
  requestId: 'req-1',
  provider: 'copilot',
  connectionKind: 'local',
  agentSessionId: 'session-1',
  chatId: 'chat-1',
  outcome: 'success',
  sessionTurnKind: 'first',
  invocationKind: 'newTurn',
  firstResponseTextMs: 120,
  rootToolCallsBeforeFirstText: 1,
  rendererRootInvocationOrdinal: 1,
  trustInteractionRequired: false,
  totalElapsedMs: 400,
  hasResponseText: true,
};

const USER_INTERACTION = {
  schemaVersion: 1,
  rendererId: 'window-1',
  interactionOrdinal: 1,
  requestId: 'req-1',
  result: 'success',
  requestPhase: 'first',
  firstProgressKind: 'text',
  timeToFirstProgress: 250,
  windowVisible: true,
  windowFocused: true,
};

it('advertises both timing capabilities while the setting is on, and exports a first-response record as a span', async () => {
  const made = host({ rootConfigStore: setting(true) });
  const p = watching();
  const client = made.accept(p);
  const meta = metaOf(await hello(client, 'window'));
  expect(meta['vscode.agentHostTiming']).toBe(true);
  expect(meta['vscode.chatUserInteractionTiming']).toBe(true);
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });

  // Fields a record must not carry reach nothing: the span is the allowlist.
  const answer = await client.handle({
    method: 'vscode/reportAgentHostFirstResponse',
    params: { ...FIRST_RESPONSE, sessionUri: 'file:///example.com/secret', text: 'the answer' },
  });
  expect(answer).toEqual({});

  const span = spans(p).find((one) => one.name === 'vscode.agent_host.first_response');
  expect(span?.kind).toBe(1);
  expect(span?.status).toEqual({ code: 1 });
  expect(span?.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(span?.spanId).toMatch(/^[0-9a-f]{16}$/);
  expect(span?.startTimeUnixNano).toBe(span?.endTimeUnixNano);
  expect(attributesOf(span as Bag)).toEqual({
    'vscode.agent_host.schemaVersion': 1,
    'vscode.agent_host.source': 'renderer',
    'vscode.agent_host.provider': 'copilot',
    'vscode.agent_host.turnId': 'req-1',
    'vscode.agent_host.agentSessionId': 'session-1',
    'vscode.agent_host.chatId': 'chat-1',
    'vscode.agent_host.requestId': 'req-1',
    'vscode.agent_host.connectionKind': 'local',
    'vscode.agent_host.outcome': 'success',
    'vscode.agent_host.sessionTurnKind': 'first',
    'vscode.agent_host.invocationKind': 'newTurn',
    'vscode.agent_host.trustInteractionRequired': false,
    'vscode.agent_host.hasResponseText': true,
    'vscode.agent_host.firstResponseTextMs': 120,
    'vscode.agent_host.rootToolCallsBeforeFirstText': 1,
    'vscode.agent_host.rendererRootInvocationOrdinal': 1,
    'vscode.agent_host.totalElapsedMs': 400,
  });
});

it('exports a user-interaction record as a span and answers after it', async () => {
  const made = host({ rootConfigStore: setting(true) });
  const p = watching();
  const client = made.accept(p);
  await hello(client, 'window');
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });

  const answer = await client.handle({ method: 'vscode/reportChatUserInteraction', params: USER_INTERACTION });
  expect(answer).toEqual({});
  // The notification was written before the answer, so a client that reads the
  // answer has the span already.
  const span = spans(p).find((one) => one.name === 'vscode.chat.user_perceived_time_to_first_progress');
  expect(span?.kind).toBe(1);
  expect(span?.status).toEqual({ code: 1 });
  expect(attributesOf(span as Bag)).toEqual({
    'vscode.chat.user_interaction.schemaVersion': 1,
    'vscode.chat.user_interaction.rendererId': 'window-1',
    'vscode.chat.user_interaction.interactionOrdinal': 1,
    'vscode.chat.user_interaction.requestId': 'req-1',
    'vscode.chat.user_interaction.result': 'success',
    'vscode.chat.user_interaction.requestPhase': 'first',
    'vscode.chat.user_interaction.firstProgressKind': 'text',
    'vscode.chat.user_interaction.timeToFirstProgress': 250,
    'vscode.chat.user_interaction.windowVisible': true,
    'vscode.chat.user_interaction.windowFocused': true,
  });
});

it('advertises nothing and exports nothing while the setting is off', async () => {
  const made = host();
  const p = watching();
  const client = made.accept(p);
  const meta = metaOf(await hello(client, 'window'));
  expect(meta['vscode.agentHostTiming']).toBeUndefined();
  expect(meta['vscode.chatUserInteractionTiming']).toBeUndefined();
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });

  // Answered with nothing, even for a record that would validate.
  expect(await client.handle({ method: 'vscode/reportAgentHostFirstResponse', params: FIRST_RESPONSE })).toEqual({});
  expect(await client.handle({ method: 'vscode/reportChatUserInteraction', params: USER_INTERACTION })).toEqual({});
  expect(spans(p)).toEqual([]);
});

it('refuses an invalid record in VS Code\'s words', async () => {
  const made = host({ rootConfigStore: setting(true) });
  const client = made.accept(watching());
  await hello(client, 'window');

  const refused = async (method: string, params: Bag) => client.handle({ method, params }).then(
    () => undefined,
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );

  // The schema refuses a record with no provider.
  expect(await refused('vscode/reportAgentHostFirstResponse', { requestId: 'req-1' }))
    .toEqual({ code: -32602, message: 'Invalid first-response diagnostic' });
  // The schema refuses a record with no renderer, and the record that passes
  // it but cannot describe a success is refused in the same words.
  expect(await refused('vscode/reportChatUserInteraction', {}))
    .toEqual({ code: -32602, message: 'Invalid user interaction timing' });
  expect(await refused('vscode/reportChatUserInteraction', { ...USER_INTERACTION, firstProgressKind: undefined }))
    .toEqual({ code: -32602, message: 'Invalid user interaction timing' });
});

it('accepts a first-response record whose join identifiers are unusable, and exports nothing for it', async () => {
  const made = host({ rootConfigStore: setting(true) });
  const p = watching();
  const client = made.accept(p);
  await hello(client, 'window');
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-otlp://traces' } });

  const answer = await client.handle({
    method: 'vscode/reportAgentHostFirstResponse',
    params: { ...FIRST_RESPONSE, provider: 'https://example.com/agent' },
  });
  expect(answer).toEqual({});
  expect(spans(p)).toEqual([]);
});
