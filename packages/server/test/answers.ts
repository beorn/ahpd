/*
 * A terminal nobody is sitting at, answered one prompt at a time.
 *
 * A prompt from `@cofold/terminal` reads keys, not lines. Each answer waits for
 * a prompt to be drawn, then sends its keys: a text answer is typed and Enter
 * sent, a yes or no answers a confirm, and an empty answer is Enter, which keeps
 * what is there. A list is answered by its arrow keys, so `\x1b[B` moves down one,
 * and the word `escape` sends the Escape key alone. Past the answers a case
 * gives, each prompt gets Enter.
 */

import { PassThrough, Writable } from 'node:stream';

/** The keys that answer one prompt, for a confirm or for a text question. */
const keysFor = (answer: string, confirm: boolean): string => {
  if (answer === 'escape') return '\x1b';
  if (!confirm) return `${answer}\r`;
  if (answer === '') return '\r';
  return /^y/iu.test(answer) ? 'y' : 'n';
};

/**
 * The streams a case asks on, and what was drawn on them as plain text.
 *
 * The answers are either strings, taken in the order the questions come, or an
 * object of answers by the words a question says; a word that names a list of
 * answers gives them to each question it names, in order, then Enter. A question with a key in the
 * object gets that answer whatever its place is; every other question gets the
 * next string, or Enter once the strings run out. A case that names its
 * answers by words does not move when a question is added.
 */
export const terminal = (...answers: (string | Readonly<Record<string, string | readonly string[]>>)[]) => {
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => undefined });
  const pending = answers.filter((one): one is string => typeof one === 'string');
  // A key with a list of answers gives them in order to each question it names, then Enter.
  const keyed: Record<string, string[]> = {};
  for (const one of answers) {
    if (typeof one === 'string') continue;
    for (const [key, value] of Object.entries(one)) keyed[key] = typeof value === 'string' ? [value] : [...value];
  }
  let said = '';
  // A prompt is answered once. Its redraws on each key carry the same foot, so
  // they are not answered again; the collapsed line `◇` ends the prompt.
  let answered = false;
  const output = Object.assign(new Writable({
    write(chunk, _encoding, done) {
      const text = String(chunk);
      said += text;
      done();
      if (text.includes('◇')) answered = false;
      if (answered || !/Enter to (confirm|choose|continue)/u.test(text)) return;
      answered = true;
      const plain = text.replace(/\u001b\[[?0-9;]*[A-Za-z]/gu, '');
      const message = /◆ {2}([^\n]*)/u.exec(plain)?.[1] ?? '';
      const named = Object.keys(keyed).filter((key) => message.includes(key)).sort((a, b) => b.length - a.length)[0];
      const queue = named === undefined ? undefined : keyed[named];
      const given = queue !== undefined ? (queue.shift() ?? '') : (pending.shift() ?? '');
      const confirm = text.includes('Left and right');
      setImmediate(() => { input.write(keysFor(given, confirm)); });
    },
  }), { isTTY: true, columns: 400 });
  return {
    // Unicode marks, whatever system runs the case: the answers find a
    // question by its `◆` and its end by its `◇`, and a Windows runner's
    // console would be drawn the ASCII ones instead.
    term: { input, output, unicode: true },
    said: () => said.replace(/\u001b\[[?0-9;]*[A-Za-z]/gu, '').replace(/\r/gu, ''),
  };
};
