import { expect, test } from 'bun:test';
import { buildNextSendKey, buildSendKey } from './build-send-key.ts';

test('#buildSendKey gives the same key for the same fault, send and since', () => {
  const first = buildSendKey('tunnel:a:22', 'open', '2026-11-17T08:00:00.000Z');

  expect(buildSendKey('tunnel:a:22', 'open', '2026-11-17T08:00:00.000Z')).toBe(first);
});

test.each([
  ['the send', 'tunnel:a:22', 'clear', '2026-11-17T08:00:00.000Z'],
  ['the since', 'tunnel:a:22', 'open', '2026-11-17T09:00:00.000Z'],
  ['the fault key', 'tunnel:b:22', 'open', '2026-11-17T08:00:00.000Z'],
] as const)('#buildSendKey gives a new key when %s changes', (_change, key, owed, since) => {
  const first = buildSendKey('tunnel:a:22', 'open', '2026-11-17T08:00:00.000Z');

  expect(buildSendKey(key, owed, since)).not.toBe(first);
});

test.each([
  ['stu-watch:0f3a', 'stu-watch:0f3a:2'],
  ['stu-watch:0f3a:2', 'stu-watch:0f3a:3'],
  ['stu-watch:0f3a:9', 'stu-watch:0f3a:10'],
])('#buildNextSendKey turns %s into %s', (sendKey, expected) => {
  expect(buildNextSendKey(sendKey)).toBe(expected);
});
