import { expect, test } from 'bun:test';
import { isRunEnviron } from './is-run-environ.ts';

test.each([
  { environ: 'PATH=/usr/bin\0HOME=/tmp/stu-verify-pear/home\0', run: true },
  { environ: 'HOME=/tmp/stu-verify-pear/home\0', run: true },
  { environ: 'HOME=/tmp/stu-verify-pear/home/inner\0', run: false },
  { environ: 'HOME=/tmp/stu-verify-plum/home\0', run: false },
  { environ: 'OLD_HOME=/tmp/stu-verify-pear/home\0', run: false },
  { environ: '', run: false },
])('it reads $environ as a process of the run: $run', (row) => {
  expect(isRunEnviron(row.environ, '/tmp/stu-verify-pear/home')).toBe(row.run);
});
