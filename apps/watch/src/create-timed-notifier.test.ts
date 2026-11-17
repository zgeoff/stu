import { expect, test } from 'bun:test';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import { createTimedNotifier } from './create-timed-notifier.ts';

function setupTest() {
  return {
    notifier: buildStubNotifier([{ kind: 'sent' }]),
    message: { text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' },
  };
}

test('it sends a message that starts before the window closes', async () => {
  const ctx = setupTest();

  const outcome = await createTimedNotifier(ctx.notifier, {
    sendUntilMs: 1000,
    readNowMs: () => 999,
  }).send(ctx.message);

  expect([outcome, ctx.notifier.sent]).toStrictEqual([{ kind: 'sent' }, [ctx.message]]);
});

test('it answers failed and sends nothing once the window has closed', async () => {
  const ctx = setupTest();

  const outcome = await createTimedNotifier(ctx.notifier, {
    sendUntilMs: 1000,
    readNowMs: () => 1000,
  }).send(ctx.message);

  expect([outcome, ctx.notifier.sent]).toStrictEqual([
    { kind: 'failed', reason: 'no time left in this run' },
    [],
  ]);
});
