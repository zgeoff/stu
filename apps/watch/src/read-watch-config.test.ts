import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatchConfig } from './read-watch-config.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder };
}

test('it loads the committed example config, which names only placeholder hosts and session', async () => {
  const examplePath = join(import.meta.dir, '..', 'stu-watch.config.example.json');

  const config = await readWatchConfig(examplePath);

  expect([
    config.atc.session,
    config.checks.flatMap((check) =>
      [check['host'], check['url']].filter((value) => value !== undefined),
    ),
  ]).toStrictEqual([
    's0-stu-session-id',
    ['tunnel-a.example', 'tunnel-b.example', 'https://app.example/health'],
  ]);
});

test('it reads a relative statePath from the config file folder', async () => {
  const ctx = await setupTest();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({ atc: { session: 's1' }, statePath: 'reported.json', checks: [] }),
  );

  const config = await readWatchConfig(configPath);

  expect(config.statePath).toBe(join(ctx.folder, 'reported.json'));
});

test('it rejects a config whose check ids repeat', async () => {
  const ctx = await setupTest();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      atc: { session: 's1' },
      statePath: 'reported.json',
      checks: [
        { id: 'tunnel', kind: 'tcp' },
        { id: 'tunnel', kind: 'http' },
      ],
    }),
  );

  expect(readWatchConfig(configPath)).rejects.toThrow('each check id must be unique');
});

test('it rejects a check id that holds a colon', async () => {
  const ctx = await setupTest();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      atc: { session: 's1' },
      statePath: 'reported.json',
      checks: [{ id: 'a:b', kind: 'tcp' }],
    }),
  );

  expect(readWatchConfig(configPath)).rejects.toThrow('a check id holds only a-z, 0-9 and -');
});
