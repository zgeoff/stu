import { expect, test } from 'bun:test';
import { isLiveProcessStat } from './is-live-process-stat.ts';

test.each([
  { stat: '30362 (claude) S 30353 30362 30362 0 -1', live: true },
  { stat: '30362 (claude) R 30353 30362 30362 0 -1', live: true },
  { stat: '30362 (claude) Z 1 30362 30362 0 -1', live: false },
  { stat: '30362 (odd) name) S 1 30362 30362 0 -1', live: true },
  { stat: '30362 (odd) name) Z 1 30362 30362 0 -1', live: false },
])('it reads $stat as live: $live', (row) => {
  expect(isLiveProcessStat(row.stat)).toBe(row.live);
});
