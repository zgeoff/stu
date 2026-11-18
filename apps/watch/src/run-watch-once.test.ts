import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { Fault } from '@stu/model';
import { buildStubSecrets } from '@stu/model/test-utils/build-stub-secrets';
import { createAtcSocketClient } from '@stu/notifier-atc';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { readReported, writeReported } from '@stu/state-file';
import { readWatchConfig } from './read-watch-config.ts';
import { runWatchOnce } from './run-watch-once.ts';
import type { WatchOnce } from './run-watch-once.ts';
import { buildNotifiers } from './tables/build-notifiers.ts';
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

  // the real notifiers, on the stub daemon unless the test names another socket
  const buildAtcNotifiers = (socketPath: string = atc.socketPath) =>
    buildNotifiers({
      atc: createAtcSocketClient({
        socketPaths: [socketPath],
        client: 'stu-watch/0.1.0',
        timeoutMs: 60_000,
      }),
    });

  return {
    folder,
    atc,
    seed: buildSeeder({ folder, stateFolder: join(folder, 'atc-state') }),
    buildAtcNotifiers,
    runAt: (configPath: string, at: string, faults: readonly Fault[]) =>
      runWatchOnce({
        configPath,
        kinds: { tcp: makeStubKind([faults]) },
        at: Temporal.Instant.from(at),
        notifiers: buildAtcNotifiers(),
        secrets: buildStubSecrets({}).secrets,
        readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,
        sleepMs: () => new Promise(() => {}),
        readConfig: readWatchConfig,
        readReported,
        writeReported,
      }),
    run: (
      watch: Pick<WatchOnce, 'configPath' | 'kinds' | 'at' | 'readNowMs' | 'sleepMs'> &
        Partial<Pick<WatchOnce, 'notifiers' | 'secrets'>>,
    ) =>
      runWatchOnce({
        notifiers: buildAtcNotifiers(),
        secrets: buildStubSecrets({}).secrets,
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
      notifiers: ctx.buildAtcNotifiers(silentSocketPath),
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

test('it gives each kind the op:// references in its params read, and reads a shared reference once', async () => {
  const ctx = await setupTest();

  const quota = makeStubKind([[]]);
  const prometheus = makeStubKind([[]]);

  const stub = buildStubSecrets({
    'op://vault-test/item-shared/credential': 'test-secret-shared',
    'op://vault-test/item-b/credential': 'test-secret-b',
  });

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        sevenPct: 85,
        slots: [
          { id: 'slot-a', token: 'op://vault-test/item-shared/credential' },
          { id: 'slot-b', token: 'op://vault-test/item-b/credential' },
        ],
      },
      {
        id: 'prometheus',
        kind: 'alerts-prometheus',
        token: 'op://vault-test/item-shared/credential',
      },
    ],
  });

  await ctx.run({
    configPath,
    kinds: { 'quota-anthropic': quota, 'alerts-prometheus': prometheus },
    secrets: stub.secrets,
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
  });

  expect([quota.mock.calls, prometheus.mock.calls]).toStrictEqual([
    [
      [
        {
          sevenPct: 85,
          slots: [
            { id: 'slot-a', token: 'test-secret-shared' },
            { id: 'slot-b', token: 'test-secret-b' },
          ],
        },
      ],
    ],
    [[{ token: 'test-secret-shared' }]],
  ]);

  expect(stub.reads).toIncludeSameMembers([
    'op://vault-test/item-shared/credential',
    'op://vault-test/item-b/credential',
  ]);
});

test('it sends one cannot-run fault for the check whose reference cannot be read, and runs the others', async () => {
  const ctx = await setupTest();

  const stub = buildStubSecrets({
    'op://vault-test/item-a/credential': 'test-secret-a',
  });

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        sevenPct: 85,
        slots: [
          { id: 'slot-a', token: 'op://vault-test/item-a/credential' },
          { id: 'slot-b', token: 'op://vault-test/item-missing/credential' },
        ],
      },
      { id: 'prometheus', kind: 'alerts-prometheus', token: 'op://vault-test/item-a/credential' },
    ],
  });

  await ctx.run({
    configPath,
    kinds: {
      'quota-anthropic': makeStubKind([[]]),
      'alerts-prometheus': makeStubKind([
        [{ key: 'alertname="DiskFull"', line: 'DiskFull firing' }],
      ]),
    },
    secrets: stub.secrets,
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
  });

  expect(ctx.atc.stored.map((message) => message.text)).toIncludeSameMembers([
    'FAULT claude-quota: cannot run: the secret at slots.1.token: the stub holds no such secret',
    'FAULT prometheus:alertname="DiskFull": DiskFull firing',
  ]);
});

test('it rejects a config whose notify kind names no notifier', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ notify: { kind: 'pager', session: 's-stu' } });

  const run = ctx.run({
    configPath,
    kinds: { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
  });

  expect(run).rejects.toThrowWithMessage(Error, 'no notifier kind named pager');
});

test('it reads no reference of a check that is not due', async () => {
  const ctx = await setupTest();

  const stub = buildStubSecrets({ 'op://vault-test/item-a/credential': 'test-secret-a' });

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'prometheus',
        kind: 'alerts-prometheus',
        everyMin: 30,
        token: 'op://vault-test/item-a/credential',
      },
    ],
  });

  const runAt = (at: string) =>
    ctx.run({
      configPath,
      kinds: { 'alerts-prometheus': makeStubKind([[], []]) },
      secrets: stub.secrets,
      at: Temporal.Instant.from(at),
      readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,
      sleepMs: () => new Promise(() => {}),
    });

  await runAt('2026-11-17T08:00:00Z');
  await runAt('2026-11-17T08:01:00Z');

  expect(stub.reads).toStrictEqual(['op://vault-test/item-a/credential']);
});
