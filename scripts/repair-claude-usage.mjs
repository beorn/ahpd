#!/usr/bin/env node
/*
 * A repair of the Claude usage records that were charged a restored total.
 *
 * A resumed Claude CLI restores the running cost its transcript last saved,
 * and before the fix the first turn after it was charged that whole total
 * again. This finds those records and works out what each turn cost.
 *
 *   node scripts/repair-claude-usage.mjs                    # print the changes, write nothing
 *   node scripts/repair-claude-usage.mjs --write            # write them, with a copy of each file
 *   node scripts/repair-claude-usage.mjs --until <time>     # only records written up to an ISO time
 *   node scripts/repair-claude-usage.mjs --verbose          # also name each chat with no transcript
 *   node scripts/repair-claude-usage.mjs --config <dir> --claude <dir>
 *
 * `--config` is the daemon's folder, `$XDG_CONFIG_HOME/ahpd` by default, and
 * `--claude` the CLI's, `$CLAUDE_CONFIG_DIR` or `~/.claude` by default.
 *
 * The CLI writes a `cost-state` line when a process ends, with what it had
 * spent on each model and no time of its own. A line is dated by the last line
 * before it that has a timestamp, which is a message of the turn that ended the
 * process, so it falls after that turn's record: a record's `at` is when its
 * turn began. A record is charged a restored total when a
 * line was written since the record before it in its chat: of those lines, the
 * largest total that is not above the record's cost is the part it was charged
 * twice. A record no line explains stays as it is, and so does a chat whose
 * transcript is not on this host.
 *
 * Each chat it changes is printed with its records' sum after the repair beside
 * the transcript's last total, which agree when every turn was recorded.
 *
 * A second run changes nothing. A record it corrected carries the cost it had
 * before in `meta['ahpd.repaired']`, and is not checked again. A chat whose
 * records already sum to the transcript's last total is left as it is, which
 * also covers a record corrected before the mark was written.
 *
 * `--write` stops while `daemon.json` names a process that runs, because the
 * daemon reads its totals from these files only when it starts.
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** A cost that differs by less than this is the same cost. */
const SAME = 0.000001;

/** A chat's sum that differs from its transcript's total by less than this agrees with it. */
const AGREES = 0.0001;

/** The `meta` key a corrected record keeps its cost from before in. */
const MARK = 'ahpd.repaired';

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
const write = argv.includes('--write');
const verbose = argv.includes('--verbose');
const until = flag('--until');
const config = flag('--config') ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ahpd');
const claude = flag('--claude') ?? (process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));

/** One JSON object per line, with the lines that are not one left out. */
const linesOf = (text) => text.split('\n').map((line, index) => {
  if (line.trim() === '') return undefined;
  try { return { index, entry: JSON.parse(line) }; }
  catch { return undefined; }
}).filter((one) => one !== undefined);

/** The ids of the agent records whose engine is `claude`. */
const claudeAgents = () => {
  const folder = join(config, 'agents');
  const ids = new Set();
  if (!existsSync(folder)) return ids;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(readFileSync(join(folder, name), 'utf8'));
      if (record.engine === 'claude' && typeof record.id === 'string') ids.add(record.id);
    }
    catch { /* A record that does not read names no agent. */ }
  }
  return ids;
};

/** The last segment of a URI such as `ahp-chat:/<id>`. */
const idOf = (uri) => (typeof uri === 'string' ? uri.slice(uri.lastIndexOf('/') + 1) : '');

/** The transcript file of a CLI session, in whichever project holds it. */
const transcriptOf = (id) => {
  const projects = join(claude, 'projects');
  if (id === '' || !existsSync(projects)) return undefined;
  for (const name of readdirSync(projects)) {
    const file = join(projects, name, `${id}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
};

/**
 * Each `cost-state` line of a transcript, as its time and its total.
 *
 * Copied from `packages/agent-claude/src/transcript.ts` rather than imported,
 * because this runs from a checkout with nothing built.
 */
const costStates = (file) => {
  const states = [];
  let at = -Infinity;
  for (const { entry } of linesOf(readFileSync(file, 'utf8'))) {
    if (typeof entry?.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp))) at = Date.parse(entry.timestamp);
    if (entry?.type !== 'cost-state') continue;
    let total = 0;
    for (const usage of Object.values(entry.modelUsage ?? {})) {
      if (typeof usage?.costUSD === 'number' && Number.isFinite(usage.costUSD)) total += usage.costUSD;
    }
    states.push({ at, total });
  }
  return states;
};

/** Whether `daemon.json` names a process that runs. */
const daemonRuns = () => {
  const file = join(config, 'daemon.json');
  if (!existsSync(file)) return false;
  try {
    const { pid } = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof pid !== 'number') return false;
    process.kill(pid, 0);
    return true;
  }
  catch (error) { return error?.code === 'EPERM'; }
};

if (write && daemonRuns()) {
  console.error(`The daemon in ${config} is running. Stop it, then run this again.`);
  process.exit(1);
}

const agents = claudeAgents();
const usage = join(config, 'usage');
const files = existsSync(usage) ? readdirSync(usage).filter((name) => /^\d{4}-\d{2}-model\.jsonl$/.test(name)).sort() : [];
const limit = until === undefined ? Infinity : Date.parse(until);
if (Number.isNaN(limit)) {
  console.error(`--until takes an ISO time, not ${until}.`);
  process.exit(1);
}

/** Every record to check, grouped by session and chat. */
const groups = new Map();
for (const name of files) {
  for (const { index, entry } of linesOf(readFileSync(join(usage, name), 'utf8'))) {
    if (entry?.kind !== 'model' || entry.source !== 'agent' || !agents.has(entry.agent)) continue;
    if (entry.cost?.from !== 'harness' || typeof entry.cost.amount !== 'number') continue;
    const at = Date.parse(entry.at);
    if (Number.isNaN(at) || at > limit) continue;
    const key = `${entry.session} ${entry.chat}`;
    const held = groups.get(key) ?? [];
    held.push({ name, index, entry, at });
    groups.set(key, held);
  }
}

/** The changes to write, by month file and line. */
const changes = new Map();
const unchecked = [];
for (const records of groups.values()) {
  records.sort((a, b) => a.at - b.at);
  const first = records[0].entry;
  const file = transcriptOf(idOf(first.chat)) ?? transcriptOf(idOf(first.session));
  if (file === undefined) {
    unchecked.push(`${first.session} ${first.chat}`);
    continue;
  }
  const states = costStates(file).filter((state) => state.at <= limit);
  const total = states.at(-1)?.total;
  const sum = records.reduce((held, record) => held + record.entry.cost.amount, 0);
  if (total !== undefined && Math.abs(sum - total) < AGREES) continue;
  let before = -Infinity;
  let recorded = 0;
  let corrected = 0;
  let after = 0;
  const lines = [];
  for (const record of records) {
    const cost = record.entry.cost.amount;
    const since = states.filter((state) => state.at > before && state.at <= record.at);
    before = record.at;
    after += cost;
    if (record.entry.meta?.[MARK] !== undefined) continue;
    const restored = Math.max(-Infinity, ...since.map((state) => state.total).filter((total) => total <= cost + SAME));
    if (restored === -Infinity || restored < SAME) continue;
    const amount = Math.max(0, cost - restored);
    recorded += cost;
    corrected += amount;
    after += amount - cost;
    lines.push(`  ${record.entry.at}  ${record.entry.turn}  ${cost.toFixed(4)} -> ${amount.toFixed(4)}`);
    const held = changes.get(record.name) ?? new Map();
    held.set(record.index, amount);
    changes.set(record.name, held);
  }
  if (lines.length === 0) continue;
  console.log(`${first.session} ${first.chat}`);
  for (const line of lines) console.log(line);
  console.log(`  recorded ${recorded.toFixed(4)}, corrected ${corrected.toFixed(4)}`);
  console.log(`  the chat's records sum to ${after.toFixed(4)} after the repair; its transcript's last total is ${total === undefined ? 'none' : total.toFixed(4)}`);
}
if (unchecked.length > 0) console.log(`${unchecked.length} chats not checked, because their transcript is not on this host.${verbose ? '' : ' Run with --verbose to name them.'}`);
if (verbose) for (const group of unchecked) console.log(`  ${group}`);

if (changes.size === 0) console.log('Nothing to change.');
else if (!write) console.log('Nothing written. Run again with --write to change these records.');
else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const [name, held] of changes) {
    const path = join(usage, name);
    copyFileSync(path, `${path}.bak-${stamp}`);
    const text = readFileSync(path, 'utf8').split('\n');
    for (const [index, amount] of held) {
      const entry = JSON.parse(text[index]);
      entry.meta = { ...entry.meta, [MARK]: entry.cost.amount };
      entry.cost = { ...entry.cost, amount };
      if (entry.providerCost !== undefined) entry.providerCost = { ...entry.providerCost, amount };
      text[index] = JSON.stringify(entry);
    }
    writeFileSync(path, text.join('\n'));
    console.log(`Wrote ${path}, with a copy at ${path}.bak-${stamp}.`);
  }
}
