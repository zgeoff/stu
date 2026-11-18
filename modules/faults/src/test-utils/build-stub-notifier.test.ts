import { expect, test } from 'bun:test';
import { buildStubNotifier } from './build-stub-notifier.ts';

test('it answers the first send with the first outcome', async () => {
  const notifier = buildStubNotifier([{ kind: 'failed', reason: 'no atc' }, { kind: 'sent' }]);

  const outcome = await notifier.send({ text: 'a', idempotencyKey: 'k1' });

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'no atc' });
});

test('it answers a send past the last outcome with the last outcome again', async () => {
  const notifier = buildStubNotifier([{ kind: 'failed', reason: 'no atc' }, { kind: 'sent' }]);

  await notifier.send({ text: 'a', idempotencyKey: 'k1' });
  await notifier.send({ text: 'b', idempotencyKey: 'k2' });

  const outcome = await notifier.send({ text: 'c', idempotencyKey: 'k3' });

  expect(outcome).toStrictEqual({ kind: 'sent' });
});

test('it records each message it is sent, in order', async () => {
  const notifier = buildStubNotifier([{ kind: 'sent' }]);

  await notifier.send({ text: 'a', idempotencyKey: 'k1' });
  await notifier.send({ text: 'b', idempotencyKey: 'k2' });

  expect(notifier.sent).toStrictEqual([
    { text: 'a', idempotencyKey: 'k1' },
    { text: 'b', idempotencyKey: 'k2' },
  ]);
});
