import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

/*
 * The repair script, run as a person runs it, over a daemon folder and a CLI
 * folder of its own. The records and the transcript are the shape this host's
 * own were in: each resumed turn charged the total the transcript last saved.
 */

const SCRIPT = fileURLToPath(new URL('../../../scripts/repair-claude-usage.mjs', import.meta.url));
const SESSION = '0f6a3c1e-7b2d-4e59-9a14-3c8d2b7e5f10';
const CHAT = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const loose: string[] = [];
afterEach(() => {
  for (const one of loose.splice(0)) rmSync(one, { recursive: true, force: true });
});

const folder = (name: string): string => {
  const made = mkdtempSync(join(tmpdir(), `ahpd-repair-${name}-`));
  loose.push(made);
  return made;
};

/** One agent turn's record, charged `amount` by the harness. */
const record = (at: string, turn: string, amount: number, session = SESSION): Record<string, unknown> => ({
  at,
  kind: 'model',
  source: 'agent',
  session: `ahp-session:/${session}`,
  chat: `ahp-chat:/${CHAT}`,
  turn,
  agent: 'claude',
  model: { name: 'claude-opus-5-5', output: 10 },
  cost: { amount, currency: 'usd', from: 'harness' },
  providerCost: { amount, currency: 'usd', from: 'harness' },
  pools: ['root:test'],
});

/** A daemon folder with one Claude agent and these records in November's file. */
const daemonWith = (records: Record<string, unknown>[]): string => {
  const config = folder('config');
  mkdirSync(join(config, 'agents'));
  writeFileSync(join(config, 'agents', 'claude.json'), JSON.stringify({ id: 'claude', engine: 'claude', owner: 'host', name: 'Claude', config: {} }));
  mkdirSync(join(config, 'usage'));
  writeFileSync(join(config, 'usage', '2026-11-model.jsonl'), records.map((one) => `${JSON.stringify(one)}\n`).join(''));
  return config;
};

/**
 * A CLI folder with the session's transcript: each entry is a message at a
 * time, or a `cost-state` line with that total.
 */
const cliWith = (lines: ({ at: string } | { total: number })[]): string => {
  const claude = folder('claude');
  const project = join(claude, 'projects', '-work');
  mkdirSync(project, { recursive: true });
  const text = lines.map((one) => JSON.stringify('at' in one
    ? { type: 'assistant', sessionId: SESSION, timestamp: one.at }
    : { type: 'cost-state', sessionId: SESSION, totalCostUSD: one.total, modelUsage: { 'claude-opus-5-5': { costUSD: one.total } } }));
  writeFileSync(join(project, `${SESSION}.jsonl`), `${text.join('\n')}\n`);
  return claude;
};

/**
 * The script's exit, as a person sees it run.
 *
 * A child run here rather than synchronously, because a worker held by one for
 * the whole file misses vitest's own calls on a slow Windows runner.
 */
const run = (config: string, claude: string, ...flags: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, '--config', config, '--claude', claude, ...flags], { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ status: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr });
    });
  });

const usageOf = (config: string): Record<string, unknown>[] => readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8')
  .split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * Five processes, each ended with a saved total, and each resumed turn after
 * them billed that total again. A record's `at` is when its turn began, and a
 * total is dated by the last message before it, a minute into the turn.
 */
const billed = [
  record('2026-11-21T07:00:00.000Z', 't1', 1),
  record('2026-11-21T07:10:00.000Z', 't2', 0.5),
  record('2026-11-21T09:00:00.000Z', 't3', 1.75),
  record('2026-11-21T10:00:00.000Z', 't4', 1.75),
  record('2026-11-21T12:00:00.000Z', 't5', 1.85),
  record('2026-11-21T16:00:00.000Z', 't6', 2.15),
];
const transcript = cliWith.bind(null, [
  { at: '2026-11-21T07:11:00.000Z' }, { total: 1.5 },
  { at: '2026-11-21T09:01:00.000Z' }, { total: 1.75 },
  { at: '2026-11-21T10:01:00.000Z' }, { total: 1.75 },
  { at: '2026-11-21T12:01:00.000Z' }, { total: 1.85 },
  { at: '2026-11-21T16:01:00.000Z' }, { total: 2.15 },
]);

it('prints each turn billed a restored total with what it cost, and writes nothing', async () => {
  const config = daemonWith(billed);
  const before = readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8');
  const answer = await run(config, transcript());
  expect(answer.status).toBe(0);
  const changed = answer.stdout.split('\n').filter((line) => line.includes(' -> '));
  expect(changed).toHaveLength(4);
  expect(answer.stdout).toContain('t3  1.7500 -> 0.2500');
  expect(answer.stdout).toContain('t4  1.7500 -> 0.0000');
  expect(answer.stdout).toContain('t5  1.8500 -> 0.1000');
  expect(answer.stdout).toContain('t6  2.1500 -> 0.3000');
  expect(answer.stdout).toContain('sum to 2.1500 after the repair; its transcript\'s last total is 2.1500');
  expect(readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8')).toBe(before);
});

it('leaves a resumed turn that was charged only its own cost', async () => {
  // A fixed host charged the resumed turn 0.25, below the 1.5 the transcript saved.
  const config = daemonWith([...billed.slice(0, 2), record('2026-11-21T09:00:00.000Z', 't3', 0.25)]);
  const answer = await run(config, cliWith([{ at: '2026-11-21T07:11:00.000Z' }, { total: 1.5 }]));
  expect(answer.status).toBe(0);
  expect(answer.stdout).not.toContain(' -> ');
  expect(answer.stdout).toContain('Nothing to change.');
});

it('names a chat whose transcript is not on this host, and changes nothing there', async () => {
  const config = daemonWith(billed);
  const answer = await run(config, folder('empty'), '--verbose');
  expect(answer.status).toBe(0);
  expect(answer.stdout).toContain('1 chats not checked');
  expect(answer.stdout).toContain(`ahp-session:/${SESSION}`);
  expect(answer.stdout).not.toContain(' -> ');
});

it('writes the corrected costs, keeps a copy, and leaves every other line as it was', async () => {
  const other = record('2026-11-21T08:00:00.000Z', 'other', 3, '11111111-2222-4333-8444-555555555555');
  const config = daemonWith([...billed, other]);
  const before = readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8');
  const answer = await run(config, transcript(), '--write');
  expect(answer.status).toBe(0);
  const copies = readdirSync(join(config, 'usage')).filter((name) => name.startsWith('2026-11-model.jsonl.bak-'));
  expect(copies).toHaveLength(1);
  expect(readFileSync(join(config, 'usage', copies[0] as string), 'utf8')).toBe(before);
  const after = usageOf(config);
  const amounts = after.map((one) => [(one.cost as { amount: number }).amount, (one.providerCost as { amount: number }).amount]);
  expect(amounts.map(([cost]) => Number(cost?.toFixed(4)))).toEqual([1, 0.5, 0.25, 0, 0.1, 0.3, 3]);
  expect(amounts.every(([cost, provider]) => cost === provider)).toBe(true);
  const lines = before.split('\n');
  const now = readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8').split('\n');
  for (const index of [0, 1, 6]) expect(now[index]).toBe(lines[index]);
});

it('marks each record it corrects with the cost it had before', async () => {
  const config = daemonWith(billed);
  expect((await run(config, transcript(), '--write')).status).toBe(0);
  const marks = usageOf(config).map((one) => (one.meta as Record<string, unknown> | undefined)?.['ahpd.repaired']);
  expect(marks).toEqual([undefined, undefined, 1.75, 1.75, 1.85, 2.15]);
});

it('changes nothing on a second run', async () => {
  const config = daemonWith(billed);
  const claude = transcript();
  expect((await run(config, claude, '--write')).status).toBe(0);
  const once = readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8');
  const answer = await run(config, claude, '--write');
  expect(answer.status).toBe(0);
  expect(answer.stdout).toContain('Nothing to change.');
  expect(readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8')).toBe(once);
});

it('leaves a chat whose records already sum to its transcript\'s last total', async () => {
  // Corrected before the mark was written: the sum agrees, but t3 is still above the 1.5 saved before it.
  const config = daemonWith([...billed.slice(0, 2), record('2026-11-21T09:00:00.000Z', 't3', 1.75)]);
  const answer = await run(config, cliWith([{ at: '2026-11-21T07:11:00.000Z' }, { total: 1.5 }, { at: '2026-11-21T09:01:00.000Z' }, { total: 3.25 }]));
  expect(answer.status).toBe(0);
  expect(answer.stdout).toContain('Nothing to change.');
});

it('skips a marked record in a chat whose sum does not agree', async () => {
  const marked = { ...record('2026-11-21T09:00:00.000Z', 't3', 1.75), meta: { 'ahpd.repaired': 3.25 } };
  const config = daemonWith([...billed.slice(0, 2), marked]);
  const answer = await run(config, cliWith([{ at: '2026-11-21T07:11:00.000Z' }, { total: 1.5 }, { at: '2026-11-21T09:01:00.000Z' }, { total: 9 }]));
  expect(answer.status).toBe(0);
  expect(answer.stdout).toContain('Nothing to change.');
});

it('stops before writing while the daemon runs', async () => {
  const config = daemonWith(billed);
  // This test's own process stands for the daemon.
  writeFileSync(join(config, 'daemon.json'), JSON.stringify({ pid: process.pid }));
  const before = readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8');
  const answer = await run(config, transcript(), '--write');
  expect(answer.status).toBe(1);
  expect(answer.stderr).toContain('is running');
  expect(readFileSync(join(config, 'usage', '2026-11-model.jsonl'), 'utf8')).toBe(before);
  expect(readdirSync(join(config, 'usage')).some((name) => name.includes('.bak-'))).toBe(false);
  expect(existsSync(join(config, 'daemon.json'))).toBe(true);
});
