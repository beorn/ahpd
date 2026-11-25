// Check the rest of AHP 1.1.0 on the test daemon, one PASS or FAIL per line.
//
//   node ahp-1-1-checks.mjs free      no model
//   node ahp-1-1-checks.mjs claude    six short Claude turns
//   node ahp-1-1-checks.mjs restart   after `claude` and a daemon restart
//
// AHPD_URL, AHPD_TOKEN_FILE and AHPD_WORK name another daemon.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { WebSocket } = createRequire(new URL('../../packages/server/package.json', import.meta.url))('ws');
const URL_OF = process.env.AHPD_URL ?? 'ws://127.0.0.1:39200';
const TOKEN = readFileSync(process.env.AHPD_TOKEN_FILE ?? join(homedir(), 'ahpd-check/token'), 'utf-8').trim();
const DIR = join(process.env.AHPD_WORK ?? join(homedir(), 'ahpd-check/work'), 'ahp-1-1');
const KEPT = `${DIR}.json`;
const ROOT = 'ahp-root://';
const uri = (path) => pathToFileURL(path).href;
const wait = (ms) => new Promise((done) => { setTimeout(done, ms); });

let failed = 0;
const check = (what, pass, got) => {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${what}${pass ? '' : `\n      got ${JSON.stringify(got)?.slice(0, 600)}`}`);
};

const connect = (version = '1.1.0') => new Promise((ready, fail) => {
  const ws = new WebSocket(`${URL_OF}/?tkn=${encodeURIComponent(TOKEN)}`);
  const asked = new Map();
  const said = [];
  let last = 0;
  let seq = 0;
  const call = (method, params) => new Promise((done) => {
    const id = ++last;
    asked.set(id, done);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
  const ask = async (method, params) => {
    const answer = await call(method, params);
    if (answer.error) throw Object.assign(new Error(`${method}: ${answer.error.message}`), answer.error);
    return answer.result;
  };
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.method === undefined) { asked.get(message.id)?.(message); asked.delete(message.id); }
    else if (message.id !== undefined) ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { trusted: true } }));
    else if (message.method === 'action') said.push(message.params);
  });
  ws.on('error', fail);
  ws.on('open', async () => {
    const hello = await ask('initialize', { channel: ROOT, clientId: `ahp-1-1-${randomUUID()}`, protocolVersions: [version], initialSubscriptions: [ROOT] });
    const state = async (channel) => (await ask('subscribe', { channel })).snapshot.state;
    const send = (channel, action) => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'dispatchAction', params: { channel, clientSeq: ++seq, action } }));
    const turn = async (chat, text, model) => {
      const before = (await state(chat)).turns.length;
      send(chat, { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' }, ...(model === undefined ? {} : { model: { id: model } }) } });
      for (const until = Date.now() + 180_000; Date.now() < until; await wait(300)) {
        const now = await state(chat);
        if (now.activeTurn === undefined && now.turns.length > before) return now.turns.at(-1);
        for (const part of now.activeTurn?.responseParts ?? []) {
          const toolCall = part.toolCall;
          if (toolCall?.status === 'pending-confirmation') send(chat, { type: 'chat/toolCallConfirmed', turnId: now.activeTurn.id, toolCallId: toolCall.toolCallId, approved: true, confirmed: 'user-action' });
        }
      }
      throw new Error('the turn did not end in 180 s');
    };
    const refused = async (method, params) => (await call(method, params)).error;
    ready({ ask, state, send, turn, refused, said, hello, close: () => ws.close() });
  });
});

const session = async (at, provider) => {
  const channel = `ahp-session:/${randomUUID()}`;
  await at.ask('createSession', { channel, provider, workingDirectories: [uri(DIR)] });
  return channel;
};
const chatOf = async (at, channel) => (await at.state(channel)).defaultChat;
const chat = async (at, channel, provider) => {
  const made = `ahp-chat:/${randomUUID()}`;
  await at.ask('createChat', { channel, chat: made, ...(provider === undefined ? {} : { provider }) });
  return made;
};
const rowsOf = async (at, channel) => (await at.state(channel)).chats;
const until = async (what, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(200)) {
    const got = await what();
    if (got !== undefined && got !== false) return got;
  }
  return undefined;
};
const repository = () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', DIR, '-c', 'user.name=Check', '-c', 'user.email=check@example.com', ...args]);
  git('init', '-q', '-b', 'main');
  writeFileSync(join(DIR, 'a.txt'), 'one\n');
  writeFileSync(join(DIR, 'word.txt'), 'hello world');
  writeFileSync(join(DIR, '.mcp.json'), JSON.stringify({ mcpServers: { desk: { type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./ahp-1-1-plugin/skills-server.mjs', import.meta.url))] } } }));
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
};

const free = async () => {
  repository();
  const at = await connect();
  const old = await connect('1.0.0');
  at.send(ROOT, { type: 'root/configChanged', config: { 'chatMoves.enabled': true, 'multipleChatProviders.enabled': true } });
  await wait(500);

  console.log('\nThe small wire items');
  check('the daemon says its path style', at.hello.environment?.pathStyle === 'posix', at.hello);
  const part = await at.ask('resourceRead', { channel: ROOT, uri: uri(join(DIR, 'word.txt')), position: 6, length: 3 });
  check('a read of bytes 6 to 8 of "hello world" answers "wor" and the size 11', part.data === 'wor' && part.size === 11, part);
  const whole = await at.ask('resourceRead', { channel: ROOT, uri: uri(join(DIR, 'word.txt')) });
  check('a read with no range answers the whole file and no size', whole.data === 'hello world' && whole.size === undefined, whole);
  const bad = await at.refused('resourceRead', { channel: ROOT, uri: uri(join(DIR, 'word.txt')), position: -1 });
  check('a negative position is refused', bad !== undefined, bad);

  console.log('\nA chat on an agent of its own');
  const fresh = await connect();
  check('a 1.1.0 client is told the host serves it', JSON.stringify(fresh.hello.multipleChatProviders) === '{}', fresh.hello);
  check('a 1.0.0 client is not', !('multipleChatProviders' in old.hello), old.hello);
  fresh.close();
  const A = await session(at, 'echo-one');
  const B = await session(at, 'echo-two');
  const own = await chat(at, A, 'echo-two');
  const ownState = await at.state(own);
  check('the new chat says its agent', ownState.provider === 'echo-two', ownState);
  check('its settings are its own agent\'s', 'tone' in (ownState.config?.schema?.properties ?? {}) && !('voice' in (ownState.config?.schema?.properties ?? {})), ownState.config);
  const unknown = await at.refused('createChat', { channel: A, chat: `ahp-chat:/${randomUUID()}`, provider: 'no-such-agent' });
  check('a chat on an agent that does not exist is refused', unknown !== undefined, unknown);
  const turn = await at.turn(own, 'hello');
  check('a turn in it ends with an answer', JSON.stringify(turn.responseParts).includes('hello'), turn);

  console.log('\nA moved chat says where it went');
  const peer = await chat(at, A);
  await at.turn(peer, 'move me');
  await old.state(peer);
  await at.ask('moveChat', { channel: peer, destination: { kind: 'session', session: B } });
  await wait(500);
  const moved = at.said.filter((one) => one.channel === peer && one.action.type === 'chat/moved').map((one) => one.action);
  check('the chat says it moved to the other session, with its own agent', moved.length === 1 && moved[0].session === B && moved[0].provider === 'echo-one', moved);
  check('a 1.0.0 client is told no such thing', !old.said.some((one) => one.action?.type === 'chat/moved'), old.said.length);
  check('the other session lists it with its own agent', (await rowsOf(at, B)).find((one) => one.resource === peer)?.provider === 'echo-one', await rowsOf(at, B));
  check('the first session lists it no more', !(await rowsOf(at, A)).some((one) => one.resource === peer), await rowsOf(at, A));
  const after = await at.turn(peer, 'still here');
  check('its next turn runs', JSON.stringify(after.responseParts).includes('still here'), after);
  at.send(ROOT, { type: 'root/configChanged', config: { 'multipleChatProviders.enabled': false } });
  await wait(500);
  const off = await at.refused('moveChat', { channel: own, destination: { kind: 'session', session: B } });
  check('with the setting off, a move across agents is refused', off?.data?.reason === 'differentProvider', off);
  const offChat = await at.refused('createChat', { channel: A, chat: `ahp-chat:/${randomUUID()}`, provider: 'echo-two' });
  check('with the setting off, a chat on another agent is refused', offChat !== undefined, offChat);
  at.send(ROOT, { type: 'root/configChanged', config: { 'multipleChatProviders.enabled': true } });

  console.log('\nA changeset row has a nonce');
  writeFileSync(join(DIR, 'a.txt'), 'two\n');
  const changes = `${A}/changeset/uncommitted`;
  const row = async () => (await at.state(changes)).files?.find((one) => one.id.endsWith('/a.txt'));
  const first = await until(async () => (await row())?.nonce);
  check('the row of a.txt has one', typeof first === 'string', await row());
  writeFileSync(join(DIR, 'a.txt'), 'owt\n');
  const target = (nonce) => ({ channel: changes, operationId: 'discard', target: { kind: 'resource', resource: uri(join(DIR, 'a.txt')), nonce } });
  const conflict = await at.refused('invokeChangesetOperation', target(first));
  check('a discard with the old nonce is refused and the file is kept', conflict?.code === -32011 && readFileSync(join(DIR, 'a.txt'), 'utf-8') === 'owt\n', conflict);
  const next = await until(async () => { const now = (await row())?.nonce; return now !== first && now; });
  const done = await at.refused('invokeChangesetOperation', target(next));
  check('a discard with the new one restores the file', done === undefined && readFileSync(join(DIR, 'a.txt'), 'utf-8') === 'one\n', done);

  for (const one of [A, B]) await at.ask('disposeSession', { channel: one }).catch(() => {});
  at.close(); old.close();
};

const claude = async () => {
  repository();
  const at = await connect();
  at.send(ROOT, { type: 'root/configChanged', config: { 'chatMoves.enabled': true } });
  const root = await at.state(ROOT);
  // A folder's .mcp.json is read only where the folder is trusted.
  at.send(ROOT, { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [...(root.config?.values?.workspaceTrust?.trustedUris ?? []), uri(DIR)] } } });
  await wait(500);
  writeFileSync(join(DIR, 'a.txt'), 'two\n');
  const models = await until(async () => { const held = (await at.state(ROOT)).agents?.find((one) => one.provider === 'claude')?.models; return held?.length > 0 && held; }) ?? [];
  const model = process.env.AHPD_MODEL ?? models.find((one) => /sonnet/i.test(one.id))?.id;
  console.log(`\nModel: ${model ?? 'the default one'}`);
  const A = await session(at, 'claude');
  const main = await chatOf(at, A);
  const changes = `${A}/changeset/uncommitted`;

  console.log('\nReasoning times and the editing mark (Claude)');
  const shown = await until(async () => (await at.state(changes)).files?.some((row) => row.id.endsWith('/a.txt')));
  check('the changed a.txt has a row', shown === true, await at.state(changes));
  const one = await at.turn(main, 'Think step by step about whether 8633 is prime, then replace the word two in a.txt with your answer, with your file editing tool.', model);
  const reasoning = one.responseParts.filter((part) => part.kind === 'reasoning');
  if (reasoning.length === 0) console.log('SKIP  the model did not think; run again with AHPD_MODEL=<a model that does>');
  else check('each reasoning part has its start and its duration', reasoning.every((part) => typeof part.startedAt === 'string' && typeof part.duration === 'number'), reasoning.map(({ startedAt, duration }) => ({ startedAt, duration })));
  const marks = at.said.filter((said) => said.channel === changes && said.action.type === 'changeset/fileSet' && said.action.file.id.endsWith('/a.txt')).map((said) => said.action.file.status ?? 0);
  check('a.txt was marked as being edited', marks.includes(1), marks);
  const clear = await until(async () => { const file = (await at.state(changes)).files?.find((row) => row.id.endsWith('/a.txt')); return file !== undefined && (file.status ?? 0) === 0; });
  check('and is not after the turn', clear === true, marks);

  console.log('\nThe skills of an MCP server (Claude)');
  const desk = async () => (await at.state(A)).customizations?.find((row) => row.name === 'desk' && row.type === 'mcpServer');
  const listed = await until(async () => (await desk())?.children?.length === 2 && (await desk()));
  check('desk lists refunds and triage, both on', listed?.children?.every((row) => row.type === 'skill' && row.enabled === true) === true, await desk());
  const two = await at.turn(main, 'Use the refunds skill with your Skill tool and tell me in one word what a refund ends with.', model);
  check('Claude read the skill: the answer says PINEAPPLE', JSON.stringify(two.responseParts).includes('PINEAPPLE'), two.responseParts);
  const refunds = listed?.children?.find((row) => row.name === 'refunds');
  at.send(A, { type: 'session/customizationToggled', id: refunds?.id, enablement: [{ kind: 'session', enabled: false }] });
  const offAt = await until(async () => (await desk())?.children?.find((row) => row.name === 'refunds')?.enabled === false);
  check('turned off, refunds shows as off and triage stays on', offAt === true && (await desk()).children.find((row) => row.name === 'triage').enabled === true, await desk());

  console.log('\nA moved Claude chat (checked again by `restart`)');
  const B = await session(at, 'claude');
  const peer = await chat(at, A);
  await at.turn(peer, 'Say hello.', model);
  await at.turn(await chatOf(at, B), 'Say hello.', model);
  await at.ask('moveChat', { channel: peer, destination: { kind: 'session', session: B } });
  check('the other session lists it', (await rowsOf(at, B)).some((row) => row.resource === peer), await rowsOf(at, B));
  writeFileSync(KEPT, JSON.stringify({ A, B, main, peer }));
  console.log('\nNow restart the test daemon, and run this with `restart`.');
  at.close();
};

const restart = async () => {
  const { A, B, main, peer } = JSON.parse(readFileSync(KEPT, 'utf-8'));
  const at = await connect();
  console.log('\nAfter a restart');
  check('the moved chat is in the session it moved to', (await rowsOf(at, B)).some((row) => row.resource === peer), await rowsOf(at, B));
  check('and not in the one it left', !(await rowsOf(at, A)).some((row) => row.resource === peer), await rowsOf(at, A));
  check('and has its turn', (await at.state(peer)).turns.length === 1, await at.state(peer));
  const parts = (await at.state(main)).turns.flatMap((turn) => turn.responseParts).filter((part) => part.kind === 'reasoning');
  if (parts.length === 0) console.log('SKIP  the chat has no reasoning part');
  else check('a restored reasoning part has its start and its duration', parts.every((part) => typeof part.startedAt === 'string' && typeof part.duration === 'number'), parts.map(({ startedAt, duration }) => ({ startedAt, duration })));
  at.close();
};

const run = { free, claude, restart }[process.argv[2]];
if (run === undefined) { console.error('usage: node ahp-1-1-checks.mjs free | claude | restart'); process.exit(2); }
try { await run(); }
catch (error) { failed += 1; console.log(`FAIL  ${error.message}`, error.data ?? ''); }
console.log(failed === 0 ? '\nAll passed.' : `\n${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
