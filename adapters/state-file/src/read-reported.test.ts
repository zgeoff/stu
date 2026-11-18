import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReported } from './read-reported.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder };
}

test('it reads a missing file as nothing reported', async () => {
  const ctx = await setupTest();
  const reported = await readReported(join(ctx.folder, 'reported.json'));

  expect(reported).toStrictEqual({ faults: {}, lastRun: {} });
});

test('it rejects a file that is not a reported state', async () => {
  const ctx = await setupTest();

  const path = join(ctx.folder, 'reported.json');

  await writeFile(path, '{"faults": []}');

  expect(readReported(path)).rejects.toThrow();
});
