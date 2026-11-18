import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWatchConfig } from './read-watch-config.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    seed: buildSeeder({ folder, stateFolder: join(folder, 'atc-state') }),
  };
}

test('it loads the committed example config, which names only placeholder hosts and session, and op:// references for its secrets', async () => {
  const examplePath = join(import.meta.dir, '..', 'stu-watch.config.example.json');

  const config = await readWatchConfig(examplePath);

  expect(config).toStrictEqual({
    notify: { kind: 'atc', session: 's0-stu-session-id' },
    statePath: join(import.meta.dir, '..', 'stu-watch.reported.json'),
    checks: [
      { id: 'memory', kind: 'memory', minAvailablePct: 10, maxFullAvg60: 20 },
      { id: 'disk', kind: 'disk', everyMin: 15, paths: ['/'], maxUsedPct: 90 },
      { id: 'tunnel-a', kind: 'tcp', host: 'tunnel-a.example', port: 2222 },
      { id: 'tunnel-b', kind: 'tcp', host: 'tunnel-b.example', port: 2222 },
      { id: 'public-route', kind: 'http', everyMin: 5, url: 'https://app.example/health' },
      { id: 'sessions-dead', kind: 'session-dead' },
      { id: 'sessions-stuck', kind: 'session-stuck', stuckMin: 30 },
      {
        id: 'prometheus',
        kind: 'alerts-prometheus',
        everyMin: 1,
        grafanaURL: 'https://grafana.example.invalid',
        datasourceUID: 'PROMETHEUS_UID',
        token: 'op://VAULT_ID/ITEM_ID_GRAFANA/credential',
      },
      {
        id: 'axiom',
        kind: 'alerts-axiom',
        everyMin: 5,
        apiURL: 'https://api.axiom.co',
        token: 'op://VAULT_ID/ITEM_ID_AXIOM/credential',
      },
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        everyMin: 30,
        sevenPct: 85,
        slots: [
          { id: 'slot-a', token: 'op://VAULT_ID/ITEM_ID_A/credential' },
          { id: 'slot-b', token: 'op://VAULT_ID/ITEM_ID_B/credential' },
          { id: 'slot-c', token: 'op://VAULT_ID/ITEM_ID_C/credential' },
          { id: 'slot-d', token: 'op://VAULT_ID/ITEM_ID_D/credential' },
        ],
      },
    ],
  });
});

test('it reads a relative statePath from the config file folder', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ statePath: 'reported.json' });
  const config = await readWatchConfig(configPath);

  expect(config.statePath).toBe(join(ctx.folder, 'reported.json'));
});

test('it rejects a config whose check ids repeat', async () => {
  const ctx = await setupTest();

  const configPath = await ctx.seed.watchConfig({
    checks: [
      { id: 'tunnel', kind: 'tcp' },
      { id: 'tunnel', kind: 'http' },
    ],
  });

  expect(readWatchConfig(configPath)).rejects.toThrow('each check id must be unique');
});

test('it rejects a check id that holds a colon', async () => {
  const ctx = await setupTest();

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'a:b', kind: 'tcp' }],
  });

  expect(readWatchConfig(configPath)).rejects.toThrow('a check id holds only a-z, 0-9 and -');
});

test('it rejects a config with a top-level atc block and no notify block', async () => {
  const ctx = await setupTest();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({ atc: { session: 's-stu' }, statePath: 'reported.json', checks: [] }),
  );

  expect(readWatchConfig(configPath)).rejects.toThrow('notify');
});
