import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
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
  const result = await runProgram(['/bin/sh', '-c', 'exec sleep 5'], { env: {}, timeoutMs: 50 });

  expect(result.code).not.toBe(0);
});

test('it gives a killed program exit 137 and an empty stdout within a second of the timeout while a child it started holds stdout open', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const startedAt = performance.now();

  const result = await runProgram(
    ['/bin/sh', '-c', `sleep 5 & echo $! > ${join(folder, 'child.pid')}; wait`],
    { env: {}, timeoutMs: 100 },
  );

  expect({ result, elapsedMs: performance.now() - startedAt }).toStrictEqual({
    result: { code: 137, stdout: '' },
    elapsedMs: expect.toBeWithin(100, 1100),
  });
});

test('it kills every process the program started when the program runs past the timeout', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const pidPath = join(folder, 'child.pid');

  await runProgram(['/bin/sh', '-c', `sleep 5 & echo $! > ${pidPath}; wait`], {
    env: {},
    timeoutMs: 100,
  });

  const childPIDText = await readFile(pidPath, 'utf8');

  const childPID = Number(childPIDText);

  await waitFor(
    () => {
      expect(() => process.kill(childPID, 0)).toThrow(/ESRCH/u);
    },
    { timeoutMs: 1000, label: 'the killed child to be reaped' },
  );
});

test('it kills a process the program left holding stdout open once the timeout passes after the program exits', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const pidPath = join(folder, 'child.pid');

  const result = await runProgram(['/bin/sh', '-c', `sleep 5 & echo $! > ${pidPath}`], {
    env: {},
    timeoutMs: 100,
  });

  const childPIDText = await readFile(pidPath, 'utf8');

  const childPID = Number(childPIDText);

  expect(result).toStrictEqual({ code: 137, stdout: '' });

  await waitFor(
    () => {
      expect(() => process.kill(childPID, 0)).toThrow(/ESRCH/u);
    },
    { timeoutMs: 1000, label: 'the killed child to be reaped' },
  );
});
