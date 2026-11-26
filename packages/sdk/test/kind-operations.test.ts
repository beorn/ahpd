import { expect, it } from 'vitest';
import { kindOffers, kindOperations, type KindShape } from '../src/kinds/operations.js';

/** The todo kind of the todo brief's `ahpd.channels` example. */
const TODO: KindShape = {
  name: 'todo',
  title: 'Todo',
  description: 'One thing to do.',
  schema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', title: 'Title', maxLength: 500 },
      done: { type: 'boolean', title: 'Done', default: false },
    },
  },
  operations: [
    { id: 'complete', label: 'Done', icon: 'check', offered: (row) => row['done'] !== true },
    { id: 'reopen', label: 'Not done', icon: 'undo', offered: (row) => row['done'] === true },
  ],
};

const idle = (): { status: 'idle' } => ({ status: 'idle' });

it('builds a kind\'s create, update, remove and own operations, with the grants and scope it is given', () => {
  const operations = kindOperations(TODO, { subject: 'todo', scope: 'todo', status: idle, update: true, words: { confirmation: 'Remove this todo?' } });
  expect(operations.map(({ id, label, scopes, grant }) => ({ id, label, scopes, grant }))).toEqual([
    { id: 'todo/create', label: 'Todo', scopes: ['list'], grant: 'todo:put' },
    { id: 'todo/update', label: 'Edit', scopes: ['todo'], grant: 'todo:put' },
    { id: 'todo/remove', label: 'Remove', scopes: ['todo'], grant: 'todo:delete' },
    { id: 'todo/complete', label: 'Done', scopes: ['todo'], grant: 'todo:put' },
    { id: 'todo/reopen', label: 'Not done', scopes: ['todo'], grant: 'todo:put' },
  ]);
  // Create and update take the kind's schema as their form, and remove asks first.
  expect(operations[0]).toMatchObject({ kind: 'todo', description: 'One thing to do.', input: TODO.schema, status: 'idle' });
  expect(operations[1]).toMatchObject({ input: TODO.schema });
  expect(operations[1]).not.toHaveProperty('description');
  expect(operations[2]).toMatchObject({ confirmation: 'Remove this todo?' });
  expect(operations[2]).not.toHaveProperty('input');
  expect(operations[3]).toMatchObject({ icon: 'check' });
  // `offered` is the host's own, and never listed.
  expect(operations[3]).not.toHaveProperty('offered');
});

it('leaves update out of a kind that is not updated, and says each call\'s status', () => {
  const operations = kindOperations(TODO, {
    subject: 'tunnel',
    scope: 'tunnel',
    status: (id) => (id === 'todo/remove' ? { status: 'error', error: 'gone' } : { status: 'idle' }),
    update: false,
    words: { remove: 'Deletes it.', confirmation: 'Remove it?' },
  });
  expect(operations.map((one) => one.id)).toEqual(['todo/create', 'todo/remove', 'todo/complete', 'todo/reopen']);
  expect(operations[1]).toMatchObject({ description: 'Deletes it.', grant: 'tunnel:delete', status: 'error', error: 'gone' });
});

it('offers on one row the operations its own offered answers for', () => {
  expect(kindOffers(TODO, { title: 'Buy milk', done: false }, true)).toEqual(['todo/update', 'todo/remove', 'todo/complete']);
  expect(kindOffers(TODO, { title: 'Call Bob', done: true }, true)).toEqual(['todo/update', 'todo/remove', 'todo/reopen']);
  expect(kindOffers(TODO, { done: true }, false)).toEqual(['todo/remove', 'todo/reopen']);
});
