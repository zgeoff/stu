import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { Fault } from '@stu/model';
import { buildStubClock } from '@stu/model/test-utils/build-stub-clock';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { createAtcNotifier, createAtcSocketClient } from '@stu/notifier-atc';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { readReported, writeReported } from '@stu/state-file';
import { waitFor } from '@zgeoff/testing/helpers';
import { readWatchConfig } from './read-watch-config.ts';
import { runWatchOnce } from './run-watch-once.ts';
import type { WatchOnce } from './run-watch-once.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  onTestFinished(() => atc.stop());

  // the real notifier, on the stub daemon unless the test names another socket
  const createNotifier =
    (socketPath: string = atc.socketPath) =>
    (session: string) =>
      createAtcNotifier({
        client: createAtcSocketClient({
          socketPaths: [socketPath],
          client: 'stu-watch/0.1.0',
          timeoutMs: 60_000,
        }),
        session,
        from: 'stu-watch',
      });

  return {
    folder,
    atc,
    seed: buildSeeder({ folder, stateFolder: join(folder, 'atc-state') }),
    createNotifier,
    runAt: (configPath: string, at: string, faults: readonly Fault[]) =>
      runWatchOnce({
        configPath,
        kinds: { tcp: makeStubKind([faults]) },
        at: Temporal.Instant.from(at),
        createNotifier: createNotifier(),
        readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,
        sleepMs: () => new Promise(() => {}),
        readConfig: readWatchConfig,
        readReported,
        writeReported,
      }),
    run: (
      watch: Pick<WatchOnce, 'configPath' | 'kinds' | 'at' | 'readNowMs' | 'sleepMs'> &
        Partial<Pick<WatchOnce, 'createNotifier'>>,
    ) =>
      runWatchOnce({
        createNotifier: createNotifier(),
        ...watch,
        readConfig: readWatchConfig,
        readReported,
        writeReported,
      }),
  };
}

test('it sends nothing new after a restart while the fault stays failing', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  await ctx.runAt(configPath, '2026-11-17T08:00:00Z', [
    { key: 'a:22', line: 'no answer from a:22' },
  ]);

  await ctx.runAt(configPath, '2026-11-17T09:30:00Z', [
    { key: 'a:22', line: 'no answer from a:22' },
  ]);

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
  ]);
});

test('it sends one recovery after a restart when the fault cleared while the watcher was down', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  await ctx.runAt(configPath, '2026-11-17T08:00:00Z', [
    { key: 'a:22', line: 'no answer from a:22' },
  ]);

  await ctx.runAt(configPath, '2026-11-17T09:30:00Z', []);

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
    'RECOVERED tunnel:a:22 (failing since 2026-11-17T08:00:00.000Z): no answer from a:22',
  ]);
});

test('it opens a cannot-run fault for a check whose kind runs past 30 seconds', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  const asked: number[] = [];

  await ctx.run({
    configPath,
    kinds: { tcp: () => new Promise(() => {}) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    sleepMs: (durationMs) => {
      asked.push(durationMs);

      return durationMs === 30_000 ? Promise.resolve() : new Promise(() => {});
    },
  });

  expect(asked).toStrictEqual([30_000, 45_000]);

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel: cannot run: timed out after 30000 ms',
  ]);
});

test('it starts no send 35 seconds after the run starts, and keeps the send owed', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  const result = await ctx.run({
    configPath,
    kinds: { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:35Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
  });

  const config = await readWatchConfig(configPath);
  const stored = await readReported(config.statePath);

  expect(ctx.atc.stored).toStrictEqual([]);

  expect(result.failures).toStrictEqual([
    { key: 'tunnel:a:22', reason: 'no time left in this run' },
  ]);

  expect(stored.faults['tunnel:a:22']?.owed).toBe('open');
});

test('it sends a message that starts just under 35 seconds after the run starts', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  await ctx.run({
    configPath,
    kinds: { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:34.999Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
  });

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
  ]);
});

test('it cuts a resend that hangs past the end of the run, and saves the fault the run found', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  const silentSocketPath = join(ctx.folder, 'silent.sock');

  const silentAtc = createServer((socket) => {
    onTestFinished(() => socket.destroy());
  });

  silentAtc.listen(silentSocketPath);

  onTestFinished(() => silentAtc.close());

  await once(silentAtc, 'listening');

  const runHung = (at: string, faults: readonly Fault[]) =>
    ctx.run({
      configPath,
      kinds: { tcp: makeStubKind([faults]) },
      at: Temporal.Instant.from(at),
      readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,

      // only the cut at the end of the sends fires; the check timeout never does
      sleepMs: (durationMs) => (durationMs === 45_000 ? Promise.resolve() : new Promise(() => {})),
      createNotifier: ctx.createNotifier(silentSocketPath),
    });

  await runHung('2026-11-17T08:00:00Z', [{ key: 'a:22', line: 'no answer from a:22' }]);

  const result = await runHung('2026-11-17T08:01:00Z', [
    { key: 'a:22', line: 'no answer from a:22' },
    { key: 'b:22', line: 'no answer from b:22' },
  ]);

  const config = await readWatchConfig(configPath);
  const stored = await readReported(config.statePath);

  expect(result.failures.map((failure) => failure.reason)).toStrictEqual([
    'atc send ran past the end of the run',
    'atc send ran past the end of the run',
  ]);

  expect(stored.faults['tunnel:b:22']?.owed).toBe('open');
});

test.each([
  {
    what: 'monitors',
    hungPath: '/v2/monitors',
    routes: { '/v2/monitors': ['hang' as const] },
  },
  {
    what: 'history of mon_b2',
    hungPath: '/v2/monitors/mon_b2/history',
    routes: {
      '/v2/monitors': [Response.json([{ id: 'mon_b2', name: 'API errors', type: 'Threshold' }])],
      '/v2/monitors/mon_b2/history': ['hang' as const],
    },
  },
])('it names what Axiom never answers, $what, inside the 30-second check timeout', async (row) => {
  const ctx = await setupTest();

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'axiom',
        kind: 'alerts-axiom',
        apiURL: 'https://api.example.invalid',
        token: 'xaat-test-token',
      },
    ],
  });

  const clock = buildStubClock(Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds);
  const axiom = buildStubFetch(row.routes);

  const run = ctx.run({
    configPath,
    kinds: {
      'alerts-axiom': makeAxiomAlertsKind({
        fetch: axiom.fetch,
        readNowMs: clock.readNowMs,
        sleepMs: clock.sleepMs,
      }),
    },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: clock.readNowMs,
    sleepMs: clock.sleepMs,
  });

  await waitFor(() => {
    expect(axiom.requests.at(-1)?.target).toStartWith(row.hungPath);
  });

  clock.passNextSleep();

  await run;

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    `FAULT axiom: cannot run: axiom gave no answer for ${row.what} (TimeoutError)`,
  ]);
});
