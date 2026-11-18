import { expect, test } from 'bun:test';
import { parseUsageHeaders } from './parse-usage-headers.ts';

test('it reads the 7-day use as a fraction, with its reset time', () => {
  const usage = parseUsageHeaders(
    new Headers({
      'anthropic-ratelimit-unified-7d-utilization': '0.4',
      'anthropic-ratelimit-unified-7d-reset': '1795300000',
    }),
  );

  expect(usage).toStrictEqual({ fraction: 0.4, resetsAt: '2026-11-21T22:26:40Z' });
});

test('it reads a 7-day use with no reset header as resetting at no known time', () => {
  const usage = parseUsageHeaders(
    new Headers({ 'anthropic-ratelimit-unified-7d-utilization': '0.2' }),
  );

  expect(usage).toStrictEqual({ fraction: 0.2, resetsAt: null });
});

test('it ignores a 5-hour use header', () => {
  const usage = parseUsageHeaders(
    new Headers({
      'anthropic-ratelimit-unified-5h-utilization': 'high',
      'anthropic-ratelimit-unified-7d-utilization': '0.2',
    }),
  );

  expect(usage).toStrictEqual({ fraction: 0.2, resetsAt: null });
});

test.each(['', 'high', '-0.1'])('it gives null for a 7-day use of %p', (sevenDay) => {
  const usage = parseUsageHeaders(
    new Headers({ 'anthropic-ratelimit-unified-7d-utilization': sevenDay }),
  );

  expect(usage).toBeNull();
});

test('it gives null when the 7-day use header is missing', () => {
  const usage = parseUsageHeaders(
    new Headers({ 'anthropic-ratelimit-unified-5h-utilization': '0.2' }),
  );

  expect(usage).toBeNull();
});
