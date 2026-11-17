import { expect, test } from 'bun:test';
import { makeTimedKind } from './make-timed-kind.ts';

test('it throws once the kind runs past the timeout', () => {
  const kind = makeTimedKind(() => new Promise(() => {}), 20);

  expect(kind({})).rejects.toThrow('timed out after 20 ms');
});

test('it gives the faults of a kind that answers in time', async () => {
  const kind = makeTimedKind(() => Promise.resolve([{ key: 'a:22', line: 'no answer' }]), 1000);

  const faults = await kind({});

  expect(faults).toStrictEqual([{ key: 'a:22', line: 'no answer' }]);
});
