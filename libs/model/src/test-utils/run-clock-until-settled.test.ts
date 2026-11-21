import { expect, test } from 'bun:test';
import { createFakeClock } from '@zgeoff/testing/clock';
import { runClockUntilSettled } from './run-clock-until-settled.ts';

test('it moves the clock through each sleep until the work resolves', async () => {
  const clock = createFakeClock({ startMs: 1000 });

  const work = (async () => {
    await clock.sleep(100);
    await clock.sleep(100);

    return clock.now();
  })();

  void clock.sleep(5000);

  await runClockUntilSettled(clock, work);

  expect(work).resolves.toBe(1200);
  expect(clock.now()).toBe(1200);
});

test('it stops once the work rejects', async () => {
  const clock = createFakeClock();

  const work = (async () => {
    await clock.sleep(100);

    throw new Error('gave up');
  })();

  await runClockUntilSettled(clock, work);

  expect(work).rejects.toThrowWithMessage(Error, 'gave up');
  expect(clock.now()).toBe(100);
});
