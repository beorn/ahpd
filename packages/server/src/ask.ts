/**
 * The questions a first run asks, and the two shapes they take.
 *
 * Every question shows what the value is now and takes Enter to keep it, so a
 * second run edits what is there rather than overwriting it with defaults
 * somebody has already changed. `choose` and `confirm` are the same question
 * with a shorter set of answers.
 *
 * The questions are drawn by `@cofold/terminal`'s prompts. A question is only
 * ever asked at a terminal: a prompt on a pipe would read an immediate end and
 * answer whatever came next, and a service that blocks on a prompt nobody can
 * see is a service that never comes back. Both refusals are here rather than at
 * each call site, so no caller has to remember.
 *
 * The streams are the caller's, so a command can ask over something that is not
 * this process's terminal and a test can answer without one.
 */

import { createPrompts } from '@cofold/terminal';
import type { Readable, Writable } from 'node:stream';

/** The two streams a question is asked on, and whether a person is on the other end. */
export interface Term {
  input: Readable & { isTTY?: boolean; setRawMode?: (on: boolean) => unknown };
  output: Writable & { isTTY?: boolean; columns?: number };
  /**
   * Whether the frame is drawn with unicode marks. Absent, cofold reads it from
   * the terminal, so a console that cannot draw them gets ASCII ones; a test
   * pins it, so what it reads back is the same frame on every system.
   */
  unicode?: boolean;
}

/** This process's own terminal, which is what a caller asks on when it names none. */
export const here: Term = { input: process.stdin, output: process.stdout };

/** Why a question was not asked, when there was nobody there to answer it. */
const NO_TERMINAL = 'There is no terminal to ask on. Run it where somebody is, or pass the setting on the command line.';

/** Why a question was not answered, when the terminal went while it was being asked. */
const CLOSED = 'The terminal closed before the question was answered.';

/**
 * Whether a person is on the other end of these streams.
 *
 * What every question needs and what a caller deciding whether to ask one needs
 * to know first: the question refuses rather than returns an answer nobody gave.
 */
export const answering = (term: Term): boolean => term.input.isTTY === true && term.output.isTTY === true;

/** The prompts for one terminal, refused when there is nobody to answer. */
const promptsOf = (term: Term) => {
  if (!answering(term)) throw new Error(NO_TERMINAL);
  return createPrompts({ input: term.input, output: term.output, ...(term.unicode === undefined ? {} : { unicode: term.unicode }) });
};

/**
 * Run one question, refused when the terminal closes or the person cancels.
 *
 * A closed input never answers a cofold prompt, so the close is raced against
 * it: a caller would otherwise wait on a terminal that is not coming back. A
 * cancel (Ctrl+C, Ctrl+D, Escape) gives the same error the close gives, as it
 * did when the questions were readline's.
 */
const asked = async <T>(term: Term, question: () => Promise<T>): Promise<T> => {
  let shut = (): void => {};
  const closed = new Promise<never>((_done, fail) => {
    shut = () => { fail(new Error(CLOSED)); };
    term.input.once('end', shut);
    term.input.once('close', shut);
  });
  closed.catch(() => {});
  try {
    return await Promise.race([question(), closed]);
  } catch (error) {
    if (error instanceof Error && error.name === 'PromptCancelled') throw new Error(CLOSED);
    throw error;
  } finally {
    term.input.off('end', shut);
    term.input.off('close', shut);
  }
};

/**
 * Ask for one value, showing what it is now.
 *
 * Enter keeps what is there and anything else replaces it, so a question can
 * never answer with nothing.
 */
export const ask = async (label: string, current: string, term: Term = here): Promise<string> => {
  const prompts = promptsOf(term);
  const typed = (await asked(term, () => prompts.text({ message: `${label} [${current}]` }))).trim();
  return typed === '' ? current : typed;
};

/**
 * Ask which of a list, with the one chosen now under the cursor.
 *
 * The list is drawn in full, so a person sees every choice before they pick one.
 */
export const choose = async (
  label: string,
  options: readonly string[],
  current: string,
  term: Term = here,
): Promise<string> => {
  const prompts = promptsOf(term);
  return asked(term, () => prompts.select({
    message: label,
    choices: options.map((one) => ({ value: one, label: one })),
    ...(options.includes(current) ? { initial: current } : {}),
  }));
};

/**
 * Ask whether something should happen, with the answer Enter gives shown.
 *
 * `yes` is the answer Enter keeps rather than the answer the question defaults
 * towards, so a caller says what the run would do without it.
 */
export const confirm = async (label: string, yes: boolean, term: Term = here): Promise<boolean> => {
  const prompts = promptsOf(term);
  return asked(term, () => prompts.confirm({ message: label, initial: yes }));
};

/**
 * Say where the configuration went, and what to run next, as the close of a run.
 *
 * Each line of `next` is drawn as the caller wrote it, so the caller lines the
 * columns up and paints them. Drawn only at a terminal; a caller without one
 * prints its own lines.
 */
export const report = async (
  saved: string,
  next: readonly string[],
  term: Term = here,
): Promise<void> => {
  const prompts = promptsOf(term);
  await prompts.group('Configuration saved', (group) => { group.line('plain', saved); });
  await prompts.group("What's next?", (group) => { for (const line of next) group.line('plain', line); });
  prompts.outro('Done.', 'plain');
};

/**
 * Say that the daemon is up: where it listens, what it has, and what to run next.
 *
 * `rows` are aligned name and value pairs, and `next` lines are drawn as the
 * caller wrote them. Drawn only at a terminal; a caller without one prints its
 * own lines.
 */
export const started = async (
  rows: readonly (readonly [string, string])[],
  next: readonly string[],
  term: Term = here,
): Promise<void> => {
  const prompts = promptsOf(term);
  await prompts.group('Daemon started', (group) => {
    group.rows(rows);
    group.line('plain', '');
    for (const line of next) group.line('plain', line);
  });
  prompts.outro('Done ahpd is running.', 'plain');
};

/** One item a multiselect offers: its value, the label a person reads, and what is said beside it. */
export interface Item<V extends string> {
  value: V;
  label: string;
  hint?: string;
}

/**
 * Ask which of a set of items to keep, with the ones on now already ticked.
 *
 * Space ticks and unticks an item, and Enter keeps the set as it stands. The
 * whole set is drawn at once, so the choices can be read against each other
 * rather than one yes or no at a time.
 */
export const multiselect = async <V extends string>(
  label: string,
  items: readonly Item<V>[],
  initial: readonly V[],
  term: Term = here,
): Promise<V[]> => {
  const prompts = promptsOf(term);
  return asked(term, () => prompts.multiselect({
    message: label,
    choices: items.map((item) => (item.hint === undefined
      ? { value: item.value, label: item.label }
      : { value: item.value, label: item.label, hint: item.hint })),
    initial: [...initial],
  }));
};
