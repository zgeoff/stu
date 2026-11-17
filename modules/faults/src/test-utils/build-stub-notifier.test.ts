import { expect, test } from 'bun:test';
import { buildStubNotifier } from './build-stub-notifier.ts';

test('it records each message and answers with each outcome in turn, then the last again', async () => {
  const notifier = buildStubNotifier([{ kind: 'failed', reason: 'no atc' }, { kind: 'sent' }]);

  const outcomes = [
    await notifier.send({ text: 'a', idempotencyKey: 'k1' }),
    await notifier.send({ text: 'b', idempotencyKey: 'k2' }),
    await notifier.send({ text: 'c', idempotencyKey: 'k3' }),
  ];

  expect([outcomes, notifier.sent.map((message) => message.text)]).toStrictEqual([
    [{ kind: 'failed', reason: 'no atc' }, { kind: 'sent' }, { kind: 'sent' }],
    ['a', 'b', 'c'],
  ]);
});
