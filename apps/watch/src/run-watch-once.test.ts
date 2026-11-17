import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { Fault } from '@stu/model';
import { runWatchOnce } from './run-watch-once.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const notifier = buildStubNotifier([{ kind: 'sent' }]);

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    notifier,
    seed: buildSeeder({ folder, stateDir: join(folder, 'atc-state') }),
    runAt: (configPath: string, at: string, faults: readonly Fault[]) =>
      runWatchOnce({
        configPath,
        kinds: { tcp: makeStubKind([faults]) },
        at: Temporal.Instant.from(at),
        createNotifier: () => notifier,
        readNowMs: () => Temporal.Instant.from(at).epochMilliseconds,
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
