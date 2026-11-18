import { expect, test } from 'bun:test';
import { parseProcessStat } from './parse-process-stat.ts';

test.each([
  { stat: '30362 (claude) S 30353 30362 30362 0 -1', state: 'S', group: 30_362 },
  { stat: '30371 (node) Z 1 30362 30362 0 -1', state: 'Z', group: 30_362 },
  { stat: '30380 (odd) name) R 30362 30362 30362 0 -1', state: 'R', group: 30_362 },
])('it reads the state $state and the group of $stat', (row) => {
  expect(parseProcessStat(row.stat)).toStrictEqual({ state: row.state, group: row.group });
});
