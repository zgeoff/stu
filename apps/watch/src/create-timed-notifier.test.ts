import { expect, test } from 'bun:test';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { SendWindow } from './create-timed-notifier.ts';
import { createTimedNotifier } from './create-timed-notifier.ts';

function setupTest() {
  return {
    notifier: buildStubNotifier([{ kind: 'sent' }]),
    message: { text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' },
    window: (overrides: Partial<SendWindow>): SendWindow => ({
      sendUntilMs: 1000,
      sendsEndMs: 2000,
      readNowMs: () => 999,
      sleepMs: () => new Promise(() => {}),
      ...overrides,
    }),
  };
}

test('it sends a message that starts before the window closes', async () => {
  const ctx = setupTest();

  const outcome = await createTimedNotifier(ctx.notifier, ctx.window({})).send(ctx.message);

  expect(outcome).toStrictEqual({ kind: 'sent' });
  expect(ctx.notifier.sent).toStrictEqual([ctx.message]);
});

test('it answers failed and sends nothing once the window has closed', async () => {
  const ctx = setupTest();

  const outcome = await createTimedNotifier(
    ctx.notifier,
    ctx.window({ readNowMs: () => 1000 }),
  ).send(ctx.message);

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'no time left in this run' });
  expect(ctx.notifier.sent).toStrictEqual([]);
});

test('it answers failed for a send still running when the sends end', async () => {
  const ctx = setupTest();
  const slept: number[] = [];

  const outcome = await createTimedNotifier(
    { send: () => new Promise(() => {}) },
    ctx.window({
      sleepMs: (durationMs) => {
        slept.push(durationMs);

        return Promise.resolve();
      },
    }),
  ).send(ctx.message);

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'atc send ran past the end of the run' });
  expect(slept).toStrictEqual([1001]);
});
