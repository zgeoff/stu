import { expect, test } from 'bun:test';
import { findOwn } from './find-own.ts';

test('it finds the value a record holds under the key', () => {
  expect(findOwn({ web: 1 }, 'web')).toBe(1);
});

test.each(['constructor', 'toString', 'missing'])(
  'it finds nothing for %s, which the record does not hold',
  (key) => {
    expect(findOwn({ web: 1 }, key)).toBeUndefined();
  },
);
