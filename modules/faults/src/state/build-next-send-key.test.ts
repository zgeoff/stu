import { expect, test } from 'bun:test';
import { buildNextSendKey } from './build-next-send-key.ts';

test.each([
  ['stu-watch:0f3a', 'stu-watch:0f3a:2'],
  ['stu-watch:0f3a:2', 'stu-watch:0f3a:3'],
  ['stu-watch:0f3a:9', 'stu-watch:0f3a:10'],
])('#buildNextSendKey turns %s into %s', (sendKey, expected) => {
  expect(buildNextSendKey(sendKey)).toBe(expected);
});
