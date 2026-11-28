import { expect, test } from 'bun:test';
import { isInsideFolder } from './is-inside-folder.ts';

test.each([
  { path: '/tmp/stu-verify-pear/run/atc-daemon.sock', inside: true },
  { path: '/tmp/stu-verify-pear', inside: false },
  { path: '/tmp/stu-verify-pearl/run/atc-daemon.sock', inside: false },
  { path: '/run/user/1000/atc-daemon.sock', inside: false },
])('it reads $path as inside the run root: $inside', (row) => {
  expect(isInsideFolder('/tmp/stu-verify-pear', row.path)).toBe(row.inside);
});
