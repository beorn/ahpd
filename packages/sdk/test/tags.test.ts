import { expect, it } from 'vitest';
import { joinTags, MAX_TAGS, tagsOf, tagsProblem } from '../src/utils/tags.js';

it('reads each string once, in order, and drops what is not a tag', () => {
  expect(tagsOf(['work', 'main', 'work', 3, '', null, 'main'])).toEqual(['work', 'main']);
  expect(tagsOf('work')).toEqual([]);
  expect(tagsOf(undefined)).toEqual([]);
});

it('refuses a list that is not fit to keep, and says why', () => {
  expect(tagsProblem(['work', 'main'])).toBeUndefined();
  expect(tagsProblem([])).toBeUndefined();
  expect(tagsProblem('work')).toBe('tags is a list of strings');
  expect(tagsProblem(['work', 1])).toBe('tags is a list of strings');
  expect(tagsProblem([''])).toBe('a tag is not empty');
  expect(tagsProblem(['a,b'])).toBe('a tag holds no comma and no control character');
  expect(tagsProblem(['a\nb'])).toBe('a tag holds no comma and no control character');
  expect(tagsProblem(['x'.repeat(65)])).toBe('a tag is at most 64 characters');
  expect(tagsProblem(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${String(i)}`))).toBe('tags holds at most 32 tags');
});

it('joins lists with each tag once, in the order they come', () => {
  expect(joinTags(['agent', 'shared'], undefined, ['shared', 'login'], [])).toEqual(['agent', 'shared', 'login']);
});
