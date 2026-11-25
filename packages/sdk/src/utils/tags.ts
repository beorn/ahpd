/**
 * Tags: the labels a person puts on an agent or a connector, which every usage
 * record of work that passed through it carries.
 *
 * A tag is a plain string, and a list holds each one once, in the order it was
 * first given.
 */

/** The most tags one list may hold. */
export const MAX_TAGS = 32;

/** The longest one tag may be. */
export const MAX_TAG_LENGTH = 64;

/** A comma, which separates tags in a query, or a control character. */
const UNFIT = /[,\u0000-\u001f\u007f]/;

/**
 * The tags a stored value holds: each string once, in order, and nothing else.
 *
 * What a record written by hand holds is read without a refusal, so a value
 * that is not a list reads as no tags.
 */
export const tagsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const one of value) if (typeof one === 'string' && one !== '' && !out.includes(one)) out.push(one);
  return out;
};

/**
 * Why a list of tags is refused, or nothing when it is fit to keep.
 *
 * A list is refused when it is not a list of strings, holds more than
 * `MAX_TAGS`, or holds a tag that is empty, longer than `MAX_TAG_LENGTH`, or
 * holds a comma or a control character.
 */
export const tagsProblem = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return 'tags is a list of strings';
  if (value.length > MAX_TAGS) return `tags holds at most ${String(MAX_TAGS)} tags`;
  for (const one of value) {
    if (typeof one !== 'string') return 'tags is a list of strings';
    if (one === '') return 'a tag is not empty';
    if (one.length > MAX_TAG_LENGTH) return `a tag is at most ${String(MAX_TAG_LENGTH)} characters`;
    if (UNFIT.test(one)) return 'a tag holds no comma and no control character';
  }
  return undefined;
};

/** Several lists as one, each tag once, in the order the lists and their tags come. */
export const joinTags = (...lists: readonly (readonly string[] | undefined)[]): string[] => {
  const out: string[] = [];
  for (const list of lists) for (const one of list ?? []) if (!out.includes(one)) out.push(one);
  return out;
};
