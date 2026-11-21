import { expect, test } from 'bun:test';
import { createFakeClock, runClockUntil } from '@zgeoff/testing/clock';
import { makeTimedKind } from './make-timed-kind.ts';

test('it throws once the kind runs past the timeout', async () => {
  const clock = createFakeClock();
  const kind = makeTimedKind(() => new Promise(() => {}), 20, clock);
  const faults = kind({});
  const tracker = { isSettled: false };

  const trackWork = async () => {
    await Promise.allSettled([faults]);

    tracker.isSettled = true;
  };

  void trackWork();

  await runClockUntil(clock, () => tracker.isSettled, { maxMs: 60_000 });

  await faults.catch(() => {});

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
