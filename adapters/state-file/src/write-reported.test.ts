import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReported } from './read-reported.ts';
import { writeReported } from './write-reported.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder };
}

test('it writes a file that reads back as the same reported state', async () => {
  const ctx = await setupTest();

  const path = join(ctx.folder, 'state', 'reported.json');

  const reported = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:0f3a',
      },
    },
    lastRun: { tunnel: '2026-11-17T08:00:00.000Z' },
  };

  await writeReported(path, reported);

  const readBack = await readReported(path);

  expect(readBack).toStrictEqual(reported);
});

test('it leaves only the reported file in the folder after a write', async () => {
  const ctx = await setupTest();

  await writeReported(join(ctx.folder, 'reported.json'), { faults: {}, lastRun: {} });

  const names = await readdir(ctx.folder);

  expect(names).toStrictEqual(['reported.json']);
});
