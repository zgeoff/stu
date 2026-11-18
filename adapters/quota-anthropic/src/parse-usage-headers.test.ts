import { expect, test } from 'bun:test';
import { parseUsageHeaders } from './parse-usage-headers.ts';

test('it reads both windows as fractions, with their reset times', () => {
  const usage = parseUsageHeaders(
    new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.92',
      'anthropic-ratelimit-unified-5h-reset': '1794906000',
      'anthropic-ratelimit-unified-7d-utilization': '0.4',
      'anthropic-ratelimit-unified-7d-reset': '1795300000',
    }),
  );

  expect(usage).toStrictEqual({
    fiveHour: { fraction: 0.92, resetsAt: '2026-11-17T09:00:00Z' },
    sevenDay: { fraction: 0.4, resetsAt: '2026-11-21T22:26:40Z' },
  });
});

test('it reads a window with no reset header as resetting at no known time', () => {
  const usage = parseUsageHeaders(
    new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.1',
      'anthropic-ratelimit-unified-7d-utilization': '0.2',
    }),
  );

  expect(usage).toStrictEqual({
    fiveHour: { fraction: 0.1, resetsAt: null },
    sevenDay: { fraction: 0.2, resetsAt: null },
  });
});

test.each(['', 'high', '-0.1'])('it gives null for a 7-day use of %p', (sevenDay) => {
  const usage = parseUsageHeaders(
    new Headers({
      'anthropic-ratelimit-unified-5h-utilization': '0.1',
      'anthropic-ratelimit-unified-7d-utilization': sevenDay,
    }),
  );

  expect(usage).toBeNull();
});

test('it gives null when the 5-hour use header is missing', () => {
  const usage = parseUsageHeaders(
    new Headers({ 'anthropic-ratelimit-unified-7d-utilization': '0.2' }),
  );

  expect(usage).toBeNull();
});
