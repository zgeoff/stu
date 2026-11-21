import { expect, test } from 'bun:test';
import { runClockUntilSettled } from '@stu/model/test-utils/run-clock-until-settled';
import { createFakeClock } from '@zgeoff/testing/clock';
import { makeTimedKind } from './make-timed-kind.ts';

test('it throws once the kind runs past the timeout', async () => {
  const clock = createFakeClock();
  const kind = makeTimedKind(() => new Promise(() => {}), 20, clock);
  const faults = kind({});

  await runClockUntilSettled(clock, faults);

  expect(faults).rejects.toThrow('timed out after 20 ms');
  expect(clock.now()).toBe(20);
});

test('it gives the faults of a kind that answers in time', async () => {
  const kind = makeTimedKind(
    () => Promise.resolve([{ key: 'a:22', line: 'no answer' }]),
    1000,
    createFakeClock(),
  );

  const faults = await kind({});

  expect(faults).toStrictEqual([{ key: 'a:22', line: 'no answer' }]);
});

test('it leaves no sleep running once a kind answers in time', async () => {
  const clock = createFakeClock();
  const kind = makeTimedKind(() => Promise.resolve([]), 1000, clock);

  await kind({});

  expect(clock.countPending()).toBe(0);
});
