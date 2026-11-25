/**
 * Edits to a process-compose file that leave every byte they do not change
 * exactly as it was (#38277, @cto).
 *
 * `yaml`'s `parseDocument` is used only to find where each node sits in the
 * original text (`range`). New text is spliced into the original string at
 * those offsets. The document is never printed again with `String(doc)`: that
 * keeps comments and key order but normalises indentation, quoting and spacing
 * elsewhere in the file, which is somebody else's hand-written native config.
 *
 * Only block mappings take a new or removed key. A flow mapping (`{a: 1}`) can
 * have a value replaced in place, but adding or removing a key in one is
 * refused rather than reformatted.
 */
import { isMap, isScalar, parse, type Document, type Pair, type Scalar, type YAMLMap } from 'yaml';
import { REMOVE, type NativeChange, type NativeValue } from './record.js';

/** One splice: replace `[start, end)` of the original text with `text`. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A layout the splice refuses to touch; the caller turns it into a refusal naming the file. */
export class LayoutError extends Error {}

interface Tree {
  value?: NativeValue | typeof REMOVE;
  children?: Map<string, Tree>;
}

const treeOf = (changes: readonly NativeChange[]): Map<string, Tree> => {
  const root = new Map<string, Tree>();
  for (const [path, value] of changes) {
    let level = root;
    path.forEach((key, at) => {
      let node = level.get(key);
      if (!node) { node = {}; level.set(key, node); }
      if (at === path.length - 1) node.value = value;
      else level = (node.children ??= new Map());
    });
  }
  return root;
};

/** Whether a subtree sets anything (as against only removing). */
const sets = (node: Tree): boolean =>
  node.children ? [...node.children.values()].some(sets) : node.value !== undefined && node.value !== REMOVE;

const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', at - 1) + 1;
/** The offset just past the line `at` ends on (past its comment and newline). */
const lineEndAfter = (text: string, at: number): number => {
  if (at > 0 && text[at - 1] === '\n') return at;
  const next = text.indexOf('\n', at);
  return next === -1 ? text.length : next + 1;
};
const column = (text: string, at: number): number => at - lineStart(text, at);
const spaces = (count: number): string => ' '.repeat(count);

const parsesAs = (yaml: string, key: string, value: unknown): boolean => {
  try {
    const read = parse(yaml) as unknown;
    return typeof read === 'object' && read !== null && Object.keys(read).length === 1
      && (read as Record<string, unknown>)[key] === value;
  }
  catch {
    return false;
  }
};

/**
 * A value as YAML text. A string keeps the style the text it replaces was
 * written in when that style can hold it exactly (checked by parsing it back),
 * and is double-quoted otherwise; JSON's string form is valid YAML.
 */
export function renderValue(value: NativeValue, style: Scalar['type'] | undefined = 'PLAIN', flow = false): string {
  if (typeof value !== 'string') return String(value);
  if (!/[\n\r]/.test(value) && !flow) {
    if (style === 'PLAIN' && value === value.trim() && parsesAs(`k: ${value}`, 'k', value)) return value;
    if (style === 'QUOTE_SINGLE') return `'${value.replace(/'/g, `''`)}'`;
  }
  return JSON.stringify(value);
}

const renderKey = (key: string): string => (parsesAs(`${key}: 1`, key, 1) ? key : JSON.stringify(key));

/** New block text for a key that does not exist yet, at `col`, children at `col + step`. */
const renderBlock = (key: string, node: Tree, col: number, step: number): string => {
  if (!node.children) return `${spaces(col)}${renderKey(key)}: ${renderValue(node.value as NativeValue)}\n`;
  let text = `${spaces(col)}${renderKey(key)}:\n`;
  for (const [child, below] of node.children) if (sets(below)) text += renderBlock(child, below, col + step, step);
  return text;
};

const pairOf = (map: YAMLMap, key: string): Pair | undefined =>
  map.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === key);

const rangeOf = (node: unknown): [number, number, number] | undefined =>
  (node as { range?: [number, number, number] | null } | null)?.range ?? undefined;

/** The whole lines a block pair takes: its key's line through the line its value ends on. */
const pairLines = (text: string, pair: Pair, where: string): [number, number] => {
  const key = rangeOf(pair.key);
  if (!key) throw new LayoutError(`${where} has no position in the file`);
  const start = lineStart(text, key[0]);
  if (text.slice(start, key[0]).trim() !== '') throw new LayoutError(`${where} does not start its own line`);
  const end = rangeOf(pair.value)?.[1] ?? key[1];
  return [start, lineEndAfter(text, end)];
};

/** Where a new key goes in a block map, and at which column: after its last pair's lines. */
const insertionOf = (text: string, map: YAMLMap, where: string): { at: number; col: number } => {
  const first = map.items[0];
  const last = map.items[map.items.length - 1];
  if (!first || !last) throw new LayoutError(`${where} is empty`);
  const firstKey = rangeOf(first.key);
  if (!firstKey) throw new LayoutError(`${where} has no position in the file`);
  return { at: pairLines(text, last, where)[1], col: column(text, firstKey[0]) };
};

/**
 * The edits that apply `tree` inside one block map. Returns `empty` when every
 * pair it had is removed and nothing is added, so the caller removes the key
 * holding it rather than leave an empty `availability:` behind.
 */
function planMap(text: string, map: YAMLMap, tree: Map<string, Tree>, step: number, where: string): { edits: Edit[]; empty: boolean } {
  const edits: Edit[] = [];
  let added = '';
  let removed = 0;
  const needsBlock = (what: string): void => {
    if (map.flow) throw new LayoutError(`${where} is a flow mapping, so ${what} would reformat it`);
  };
  for (const [key, node] of tree) {
    const here = `${where}.${key}`;
    const pair = pairOf(map, key);
    const value = pair?.value;
    if (!node.children) {
      if (node.value === undefined) continue;
      if (node.value === REMOVE) {
        if (!pair) continue;
        needsBlock(`removing ${key}`);
        const [start, end] = pairLines(text, pair, here);
        edits.push({ start, end, text: '' });
        removed += 1;
        continue;
      }
      if (pair && isScalar(value) && value.value !== null) {
        if (value.value === node.value) continue;
        const range = rangeOf(value);
        if (!range) throw new LayoutError(`${here} has no position in the file`);
        edits.push({ start: range[0], end: range[1], text: renderValue(node.value, value.type, Boolean(map.flow)) });
        continue;
      }
      if (pair) {
        if (!(isScalar(value) || value === null || value === undefined)) throw new LayoutError(`${here} is not a single value`);
        needsBlock(`setting ${key}`);
        const [start, end] = pairLines(text, pair, here);
        edits.push({ start, end, text: '' });
        removed += 1;
      }
      needsBlock(`adding ${key}`);
      added += renderBlock(key, node, 0, step);
      continue;
    }
    if (pair && isMap(value)) {
      const inner = planMap(text, value, node.children, step, here);
      if (inner.empty) {
        needsBlock(`removing ${key}`);
        const [start, end] = pairLines(text, pair, here);
        edits.push({ start, end, text: '' });
        removed += 1;
      }
      else edits.push(...inner.edits);
      continue;
    }
    if (pair && !(isScalar(value) && value.value === null) && value !== null && value !== undefined) {
      throw new LayoutError(`${here} is not a mapping`);
    }
    if (!sets(node)) continue;
    needsBlock(`adding ${key}`);
    if (pair) {
      const [start, end] = pairLines(text, pair, here);
      edits.push({ start, end, text: '' });
      removed += 1;
    }
    added += renderBlock(key, node, 0, step);
  }
  if (added !== '') {
    const { at, col } = insertionOf(text, map, where);
    const indented = added.split('\n').map((line) => (line === '' ? line : spaces(col) + line)).join('\n');
    edits.push({ start: at, end: at, text: at > 0 && text[at - 1] !== '\n' ? `\n${indented}` : indented });
  }
  return { edits, empty: removed === map.items.length && added === '' };
}

/** The text with every edit applied; the edits are against the original offsets and never overlap. */
export function splice(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > floor) throw new LayoutError('two edits overlap');
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

/** The `processes` map of a document, or nothing when the file has none. */
export function processesOf(doc: Document): YAMLMap | undefined {
  const node = doc.get('processes', true);
  if (node === undefined || node === null || (isScalar(node) && node.value === null)) return undefined;
  if (!isMap(node)) throw new LayoutError('processes is not a mapping');
  return node;
}

/** The file's indent step, read from how far an entry's keys sit inside `processes`. */
const stepOf = (text: string, processes: YAMLMap | undefined): number => {
  const entry = processes?.items[0];
  const entryKey = rangeOf(entry?.key);
  const inner = isMap(entry?.value) ? rangeOf(entry.value.items[0]?.key) : undefined;
  if (!entryKey || !inner) return 2;
  const step = column(text, inner[0]) - column(text, entryKey[0]);
  return step > 0 ? step : 2;
};

/** Apply native changes to the existing entry `name`: only the changed keys' bytes move. */
export function editEntry(text: string, doc: Document, name: string, changes: readonly NativeChange[]): string {
  const processes = processesOf(doc);
  const entry = processes ? pairOf(processes, name)?.value : undefined;
  if (!isMap(entry)) throw new LayoutError(`processes.${name} is not a mapping`);
  const { edits } = planMap(text, entry, treeOf(changes), stepOf(text, processes), `processes.${name}`);
  return splice(text, edits);
}

/** Append a new entry as a block at the end of `processes` (or add `processes` at the end of the file). */
export function addEntry(text: string, doc: Document, name: string, changes: readonly NativeChange[]): string {
  const processes = processesOf(doc);
  const step = stepOf(text, processes);
  const block = renderBlock(name, { children: treeOf(changes) }, 0, step);
  if (!processes) {
    const lead = text === '' || text.endsWith('\n') ? '' : '\n';
    return `${text}${lead}processes:\n${block.split('\n').map((line) => (line === '' ? line : spaces(step) + line)).join('\n')}`;
  }
  if (processes.flow) throw new LayoutError('processes is a flow mapping, so adding an entry would reformat it');
  const { at, col } = insertionOf(text, processes, 'processes');
  const indented = block.split('\n').map((line) => (line === '' ? line : spaces(col) + line)).join('\n');
  return splice(text, [{ start: at, end: at, text: at > 0 && text[at - 1] !== '\n' ? `\n${indented}` : indented }]);
}

/** Remove the entry `name`: its whole lines go; a `processes` left empty becomes `{}`. */
export function removeEntry(text: string, doc: Document, name: string): string {
  const processes = processesOf(doc);
  const pair = processes ? pairOf(processes, name) : undefined;
  if (!processes || !pair) throw new LayoutError(`processes.${name} is not in the file`);
  if (processes.flow) throw new LayoutError('processes is a flow mapping, so removing an entry would reformat it');
  const [start, end] = pairLines(text, pair, `processes.${name}`);
  const keyAt = rangeOf(pair.key)![0];
  const empty = processes.items.length === 1 ? `${spaces(column(text, keyAt))}{}\n` : '';
  return splice(text, [{ start, end, text: empty }]);
}

/**
 * A unified-style line diff of `before` → `after`, with two lines of context.
 * Plain longest-common-subsequence: these files are tens to hundreds of lines.
 */
export function lineDiff(before: string, after: string, from: string, to: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const rows = a.length + 1;
  const cols = b.length + 1;
  const common = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * cols + j] = a[i] === b[j] ? common[(i + 1) * cols + j + 1]! + 1 : Math.max(common[(i + 1) * cols + j]!, common[i * cols + j + 1]!);
    }
  }
  const ops: Array<{ mark: ' ' | '-' | '+'; line: string; old: number; new: number }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ mark: ' ', line: a[i]!, old: i, new: j }); i += 1; j += 1; }
    else if (i < a.length && (j === b.length || common[(i + 1) * cols + j]! >= common[i * cols + j + 1]!)) { ops.push({ mark: '-', line: a[i]!, old: i, new: j }); i += 1; }
    else { ops.push({ mark: '+', line: b[j]!, old: i, new: j }); j += 1; }
  }
  const CONTEXT = 2;
  const keep = ops.map((op, at) => ops.slice(Math.max(0, at - CONTEXT), at + CONTEXT + 1).some((near) => near.mark !== ' '));
  const lines = [`--- ${from}`, `+++ ${to}`];
  for (let at = 0; at < ops.length; at += 1) {
    if (!keep[at]) continue;
    if (at === 0 || !keep[at - 1]) lines.push(`@@ -${ops[at]!.old + 1} +${ops[at]!.new + 1} @@`);
    lines.push(`${ops[at]!.mark}${ops[at]!.line}`);
  }
  return lines.join('\n');
}
