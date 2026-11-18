import { expect, test } from 'bun:test';
import { parseChildPIDs } from './parse-child-pids.ts';

test('it parses each pid of a children list', () => {
  expect(parseChildPIDs('30362 30371 \n')).toStrictEqual([30_362, 30_371]);
});

test('it parses an empty children list as no pids', () => {
  expect(parseChildPIDs('')).toStrictEqual([]);
});
