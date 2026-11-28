import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { Fault, RunProgram } from '@stu/model';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { buildStubSecrets } from '@stu/model/test-utils/build-stub-secrets';
import { createAtcClient } from '@stu/notifier-atc';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { createSecretsOp } from '@stu/secrets-op';
import { readReported, writeReported } from '@stu/state-file';
import { waitFor } from '@zgeoff/testing';
import { createFakeClock, runClockUntil } from '@zgeoff/testing/clock';
import { readWatchConfig } from './read-watch-config.ts';
import { runWatchOnce } from './run-watch-once.ts';
import type { WatchOnce } from './run-watch-once.ts';
import { buildNotifiers } from './tables/build-notifiers.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    major: 8,
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
      atc: createAtcClient({
        socketPath,
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
        clock: createFakeClock({ startMs: Temporal.Instant.from(at).epochMilliseconds }),
        readConfig: readWatchConfig,
        readReported,
        writeReported,
      }),
    run: (
      watch: Pick<WatchOnce, 'configPath' | 'kinds' | 'at' | 'clock'> &
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

  const startMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;
  const clock = createFakeClock({ startMs });

  const run = ctx.run({
    configPath,
    kinds: { tcp: () => new Promise(() => {}) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    clock,
  });

  // the check's timeout is the first sleep, once the run has read its config
  await waitFor(() => {
    expect(clock.readNextDueMs()).toBe(startMs + 30_000);
  });

  clock.advance(30_000);

  await run;

  // the send is cut 45 seconds into the run, which is 15 seconds after the check times out
  expect(clock.delays).toStrictEqual([30_000, 15_000]);

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
    clock: createFakeClock({
      startMs: Temporal.Instant.from('2026-11-17T08:00:35Z').epochMilliseconds,
    }),
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
    clock: createFakeClock({
      startMs: Temporal.Instant.from('2026-11-17T08:00:34.999Z').epochMilliseconds,
    }),
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

  const runHung = async (at: string, faults: readonly Fault[]) => {
    const startMs = Temporal.Instant.from(at).epochMilliseconds;
    const clock = createFakeClock({ startMs });

    const run = ctx.run({
      configPath,
      kinds: { tcp: makeStubKind([faults]) },
      at: Temporal.Instant.from(at),

      // now stays at the start of the run, so each owed send starts and reaches its own cut
      clock: { now: () => startMs, sleep: clock.sleep },
      notifiers: ctx.buildAtcNotifiers(silentSocketPath),
    });

    // only the cuts at the end of the sends fire: the check answers, so its timeout is cancelled
    const tracker = { isSettled: false };

    const trackWork = async () => {
      await Promise.allSettled([run]);

      tracker.isSettled = true;
    };

    void trackWork();

    await runClockUntil(clock, () => tracker.isSettled, { maxMs: 3_600_000 });

    await run.catch(() => {});

    return run;
  };

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

  const clock = createFakeClock({
    startMs: Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
  });

  const axiom = buildStubFetch(row.routes);

  const run = ctx.run({
    configPath,
    kinds: {
      'alerts-axiom': makeAxiomAlertsKind({
        fetch: axiom.fetch,
        clock,
      }),
    },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    clock,
  });

  await waitFor(() => {
    expect(axiom.requests.at(-1)?.target).toStartWith(row.hungPath);
  });

  // the first sleep to end is the 10-second limit of the hung request
  clock.advance(10_000);

  await run;

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    `FAULT axiom: cannot run: axiom gave no answer for ${row.what} (TimeoutError)`,
  ]);
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
    clock: createFakeClock({
      startMs: Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    }),
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
    clock: createFakeClock({
      startMs: Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    }),
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
    clock: createFakeClock({
      startMs: Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    }),
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
      clock: createFakeClock({ startMs: Temporal.Instant.from(at).epochMilliseconds }),
    });

  await runAt('2026-11-17T08:00:00Z');
  await runAt('2026-11-17T08:01:00Z');

  expect(stub.reads).toStrictEqual(['op://vault-test/item-a/credential']);
});

test('it opens a cannot-run fault for a check whose secret read runs past 30 seconds', async () => {
  const ctx = await setupTest();

  const prometheus = makeStubKind([[]]);

  const configPath = await ctx.seed.watchConfig({
    checks: [
      { id: 'prometheus', kind: 'alerts-prometheus', token: 'op://vault-test/item-a/credential' },
    ],
  });

  const startMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;
  const clock = createFakeClock({ startMs });

  const run = ctx.run({
    configPath,
    kinds: { 'alerts-prometheus': prometheus },
    secrets: { readSecret: () => new Promise(() => {}) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    clock,
  });

  await waitFor(() => {
    expect(clock.readNextDueMs()).toBe(startMs + 30_000);
  });

  clock.advance(30_000);

  await run;

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT prometheus: cannot run: timed out after 30000 ms',
  ]);
});

test('it reads four slow references at once, inside the 30-second check timeout', async () => {
  const ctx = await setupTest();

  const quota = makeStubKind([[]]);

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        sevenPct: 85,
        slots: [
          { id: 'slot-a', token: 'op://vault-test/item-a/credential' },
          { id: 'slot-b', token: 'op://vault-test/item-b/credential' },
          { id: 'slot-c', token: 'op://vault-test/item-c/credential' },
          { id: 'slot-d', token: 'op://vault-test/item-d/credential' },
        ],
      },
    ],
  });

  const startMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;
  const clock = createFakeClock({ startMs });

  const values: Readonly<Record<string, string>> = {
    'op://vault-test/item-a/credential': 'test-secret-a',
    'op://vault-test/item-b/credential': 'test-secret-b',
    'op://vault-test/item-c/credential': 'test-secret-c',
    'op://vault-test/item-d/credential': 'test-secret-d',
  };

  // each op read takes 8 seconds, so four in a row would run past the check timeout
  const slowRun: RunProgram = async (argv) => {
    await clock.sleep(8000);

    return { code: 0, stdout: `${values[argv[2] ?? ''] ?? ''}\n` };
  };

  const run = ctx.run({
    configPath,
    kinds: { 'quota-anthropic': quota },
    secrets: createSecretsOp({
      run: slowRun,
      opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
      serviceAccountToken: 'ops-test-token',
    }),
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    clock,
  });

  const tracker = { isSettled: false };

  const trackWork = async () => {
    await Promise.allSettled([run]);

    tracker.isSettled = true;
  };

  void trackWork();

  await runClockUntil(clock, () => tracker.isSettled, { maxMs: 60_000 });
  await run;

  expect({ elapsedMs: clock.now() - startMs, calls: quota.mock.calls }).toStrictEqual({
    elapsedMs: 8000,
    calls: [
      [
        {
          sevenPct: 85,
          slots: [
            { id: 'slot-a', token: 'test-secret-a' },
            { id: 'slot-b', token: 'test-secret-b' },
            { id: 'slot-c', token: 'test-secret-c' },
            { id: 'slot-d', token: 'test-secret-d' },
          ],
        },
      ],
    ],
  });

  expect(ctx.atc.stored).toStrictEqual([]);
});

test('it names the param whose op read hangs, and not its reference, inside the 30-second check timeout', async () => {
  const ctx = await setupTest();

  const configPath = await ctx.seed.watchConfig({
    checks: [
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        sevenPct: 85,
        slots: [{ id: 'slot-b', token: 'op://vault-test/item-b/credential' }],
      },
    ],
  });

  const startMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;
  const clock = createFakeClock({ startMs });

  // a hung op that the runner kills at its limit, whose exit reaches the watcher just after
  const hungRun: RunProgram = async (_argv, options) => {
    await clock.sleep(options.timeoutMs + 1);

    return { code: 137, stdout: '' };
  };

  const run = ctx.run({
    configPath,
    kinds: { 'quota-anthropic': makeStubKind([[]]) },
    secrets: createSecretsOp({
      run: hungRun,
      opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
      serviceAccountToken: 'ops-test-token',
    }),
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    clock,
  });

  // the op read's end is due before the check timeout
  await waitFor(() => {
    expect(clock.readNextDueMs()).toBe(startMs + 10_001);
  });

  clock.advance(10_001);

  await run;

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT claude-quota: cannot run: the secret at slots.0.token: op read failed (exit 137)',
  ]);
});
