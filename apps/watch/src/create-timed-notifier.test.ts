import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcNotifier, createAtcSocketClient } from '@stu/notifier-atc';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { createTimedNotifier } from './create-timed-notifier.ts';

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

  return {
    folder,
    atc,
    createNotifier: (socketPath: string) =>
      createAtcNotifier({
        client: createAtcSocketClient({
          socketPaths: [socketPath],
          client: 'stu-watch/0.1.0',
          timeoutMs: 60_000,
        }),
        session: 's-stu',
        from: 'stu-watch',
      }),
  };
}

test('it sends a message that starts before the window closes', async () => {
  const ctx = await setupTest();

  const outcome = await createTimedNotifier(ctx.createNotifier(ctx.atc.socketPath), {
    sendUntilMs: 1000,
    sendsEndMs: 2000,
    readNowMs: () => 999,
    sleepMs: () => new Promise(() => {}),
  }).send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'sent' });

  expect(ctx.atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
  ]);
});

test('it answers failed and sends nothing once the window has closed', async () => {
  const ctx = await setupTest();

  const outcome = await createTimedNotifier(ctx.createNotifier(ctx.atc.socketPath), {
    sendUntilMs: 1000,
    sendsEndMs: 2000,
    readNowMs: () => 1000,
    sleepMs: () => new Promise(() => {}),
  }).send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'no time left in this run' });
  expect(ctx.atc.stored).toStrictEqual([]);
});

test('it answers failed for a send still running when the sends end', async () => {
  const ctx = await setupTest();

  const silentSocketPath = join(ctx.folder, 'silent.sock');

  const silentAtc = createServer((socket) => {
    onTestFinished(() => socket.destroy());
  });

  silentAtc.listen(silentSocketPath);

  onTestFinished(() => silentAtc.close());

  await once(silentAtc, 'listening');

  const slept: number[] = [];

  const outcome = await createTimedNotifier(ctx.createNotifier(silentSocketPath), {
    sendUntilMs: 1000,
    sendsEndMs: 2000,
    readNowMs: () => 999,
    sleepMs: (durationMs) => {
      slept.push(durationMs);

      return Promise.resolve();
    },
  }).send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'atc send ran past the end of the run' });
  expect(slept).toStrictEqual([1001]);
});
