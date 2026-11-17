import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedWatchConfig } from './seed-watch-config.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder };
}

test('it writes stu-watch.config.json in the folder and gives its path', async () => {
  const ctx = await setupTest();
  const configPath = await seedWatchConfig({ folder: ctx.folder });
  const text = await readFile(configPath, 'utf8');

  const written: unknown = JSON.parse(text);

  expect([configPath, written]).toStrictEqual([
    join(ctx.folder, 'stu-watch.config.json'),
    {
      atc: { session: 's-stu' },
      statePath: 'reported.json',
      checks: [{ id: 'tunnel', kind: 'tcp', host: 'tunnel-a.example', port: 2222 }],
    },
  ]);
});

test('it writes the checks it is given', async () => {
  const ctx = await setupTest();
  const configPath = await seedWatchConfig({ folder: ctx.folder }, { checks: [] });
  const text = await readFile(configPath, 'utf8');

  const written: unknown = JSON.parse(text);

  expect(written).toMatchObject({ checks: [] });
});
