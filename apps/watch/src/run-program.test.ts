import { expect, test } from 'bun:test';
import { runProgram } from './run-program.ts';

test('it gives the exit code and stdout, and passes only the env it is given', async () => {
  const result = await runProgram(['/bin/sh', '-c', 'echo "$STU_TEST_VALUE:$HOME"; exit 3'], {
    env: { STU_TEST_VALUE: 'given' },
    timeoutMs: 5000,
  });

  expect(result).toStrictEqual({ code: 3, stdout: 'given:\n' });
});

test('it leaves stderr out of the result', async () => {
  const result = await runProgram(['/bin/sh', '-c', 'echo secret-on-stderr >&2'], {
    env: {},
    timeoutMs: 5000,
  });

  expect(result).toStrictEqual({ code: 0, stdout: '' });
});

test('it kills a program that runs past the timeout and gives a non-zero code', async () => {
  const result = await runProgram(['/bin/sh', '-c', 'sleep 5'], { env: {}, timeoutMs: 50 });

  expect(result.code).not.toBe(0);
});
