import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { Fault } from '@stu/model';
import { readReported, writeReported } from '@stu/state-file';
import { readWatchConfig } from './read-watch-config.ts';
import { runWatchOnce } from './run-watch-once.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const notifier = buildStubNotifier([{ kind: 'sent' }]);

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    notifier,
    seed: buildSeeder({ folder, stateFolder: join(folder, 'atc-state') }),
    runAt: (configPath: string, at: string, faults: readonly Fault[]) =>
      runWatchOnce({
        configPath,
        kinds: { tcp: makeStubKind([faults]) },
        at: Temporal.Instant.from(at),
        createNotifier: () => notifier,
        readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,
        sleepMs: () => new Promise(() => {}),
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

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
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

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
    'RECOVERED tunnel:a:22 (failing since 2026-11-17T08:00:00.000Z): no answer from a:22',
  ]);
});

test('it opens a cannot-run fault for a check whose kind runs past 30 seconds', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  const asked: number[] = [];

  await runWatchOnce({
    configPath,
    kinds: { tcp: () => new Promise(() => {}) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    createNotifier: () => ctx.notifier,
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds,
    sleepMs: (durationMs) => {
      asked.push(durationMs);

      return Promise.resolve();
    },
    readConfig: readWatchConfig,
    readReported,
    writeReported,
  });

  expect(asked).toStrictEqual([30_000]);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel: cannot run: timed out after 30000 ms',
  ]);
});

test('it starts no send 35 seconds after the run starts, and keeps the send owed', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  const result = await runWatchOnce({
    configPath,
    kinds: { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    createNotifier: () => ctx.notifier,
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:35Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
    readConfig: readWatchConfig,
    readReported,
    writeReported,
  });

  const stored = await readReported(join(ctx.folder, 'reported.json'));

  expect(ctx.notifier.sent).toStrictEqual([]);

  expect(result.failures).toStrictEqual([
    { key: 'tunnel:a:22', reason: 'no time left in this run' },
  ]);

  expect(stored.faults['tunnel:a:22']?.owed).toBe('open');
});

test('it sends a message that starts just under 35 seconds after the run starts', async () => {
  const ctx = await setupTest();
  const configPath = await ctx.seed.watchConfig({ checks: [{ id: 'tunnel', kind: 'tcp' }] });

  await runWatchOnce({
    configPath,
    kinds: { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) },
    at: Temporal.Instant.from('2026-11-17T08:00:00Z'),
    createNotifier: () => ctx.notifier,
    readNowMs: () => Temporal.Instant.from('2026-11-17T08:00:34.999Z').epochMilliseconds,
    sleepMs: () => new Promise(() => {}),
    readConfig: readWatchConfig,
    readReported,
    writeReported,
  });

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
  ]);
});
