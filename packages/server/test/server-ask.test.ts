/*
 * The questions `ahpd configure` asks, over streams that are not a terminal.
 *
 * Every case is about what one question makes of what was typed: the default it
 * shows, what Enter keeps, and when it gives up rather than waiting for an
 * answer nobody is there to give. The two streams are faked so nothing here
 * reads this process's own terminal.
 */

import { expect, it } from 'vitest';
import { ask, choose, confirm, multiselect } from '../src/ask.js';
import { terminal } from './answers.js';

/** The backends `configure` offers, which is the list the choice is asked over. */
const BACKENDS = ['Claude', 'cofold', 'pi'];
/** The arrow key that moves a list's cursor down one choice. */
const DOWN = '\x1b[B';

it('keeps the default on Enter and takes what was typed instead', async () => {
  const kept = terminal('');
  expect(await ask('Port', '9187', kept.term)).toBe('9187');
  expect(kept.said()).toContain('Port [9187]');

  const typed = terminal('9000');
  expect(await ask('Port', '9187', typed.term)).toBe('9000');
});

it('takes a choice by moving down the list, and keeps the current one on Enter', async () => {
  const moved = terminal(`${DOWN}${DOWN}`);
  expect(await choose('Backends', BACKENDS, 'Claude', moved.term)).toBe('pi');
  expect(moved.said()).toContain('Backends');
  expect(moved.said()).toContain('Claude');
  expect(moved.said()).toContain('cofold');

  const kept = terminal('');
  expect(await choose('Backends', BACKENDS, 'cofold', kept.term)).toBe('cofold');
});

it('starts the cursor on the current choice', async () => {
  const kept = terminal('');
  expect(await choose('Backends', BACKENDS, 'pi', kept.term)).toBe('pi');
});

it('keeps the ticked items on Enter, and ticks or unticks an item on Space', async () => {
  const items = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', hint: 'the second' }, { value: 'c', label: 'Gamma' }];
  const kept = terminal('');
  expect(await multiselect('Which?', items, ['a', 'c'], kept.term)).toEqual(['a', 'c']);
  expect(kept.said()).toContain('Beta');

  // Down to Beta and tick it, then Enter.
  expect(await multiselect('Which?', items, ['a'], terminal('\x1b[B \r').term)).toEqual(['a', 'b']);
  // Space on the first item unticks it.
  expect(await multiselect('Which?', items, ['a', 'c'], terminal(' ').term)).toEqual(['c']);
});

it('answers a yes and a no, and keeps the one it was given on Enter', async () => {
  const yes = terminal('y');
  expect(await confirm('Serve /tmp/new?', true, yes.term)).toBe(true);
  expect(yes.said()).toContain('Serve /tmp/new?');

  const no = terminal('no');
  expect(await confirm('Serve /tmp/new?', true, no.term)).toBe(false);

  const kept = terminal('');
  expect(await confirm('Serve /tmp/new?', true, kept.term)).toBe(true);
  expect(await confirm('Serve /tmp/new?', false, terminal('').term)).toBe(false);
});

it('refuses a question there is no terminal to ask, rather than waiting', async () => {
  const piped = terminal('');
  piped.term.input.isTTY = false;
  await expect(ask('Port', '9187', piped.term)).rejects.toThrow(/no terminal/i);
  await expect(choose('Backends', BACKENDS, 'Claude', piped.term)).rejects.toThrow(/no terminal/i);
  await expect(confirm('Serve it?', true, piped.term)).rejects.toThrow(/no terminal/i);
});

it('refuses a question the person cancels with Escape, as it refuses a closed terminal', async () => {
  const cancelled = terminal('escape');
  await expect(ask('Port', '9187', cancelled.term)).rejects.toThrow(/closed/i);
});

it('refuses a question whose terminal closed before it was answered', async () => {
  const shut = terminal('');
  shut.term.input.end();
  await expect(ask('Port', '9187', shut.term)).rejects.toThrow(/closed/i);
});
