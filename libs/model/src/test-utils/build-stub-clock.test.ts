import { expect, test } from 'bun:test';
import { buildStubClock } from './build-stub-clock.ts';

test('it passes the sleep that ends first, and moves the clock to its end', () => {
  const clock = buildStubClock(1000);

  void clock.sleepMs(500, new AbortController().signal);
  const short = clock.sleepMs(200, new AbortController().signal);

  clock.passNextSleep();

  expect(short).resolves.toBeUndefined();
  expect(clock.readNowMs()).toBe(1200);
});

test('it rejects a sleep with its signal reason once the signal aborts, and never passes it', async () => {
  const clock = buildStubClock(0);

  const stop = new AbortController();

  const sleep = clock.sleepMs(100, stop.signal);

  void clock.sleepMs(300, new AbortController().signal);
  stop.abort(new Error('stopped'));
  clock.passNextSleep();

  expect([await sleep.catch((error: unknown) => error), clock.readNowMs()]).toStrictEqual([
    new Error('stopped'),
    300,
  ]);
});

test('it passes sleeps until the work settles', async () => {
  const clock = buildStubClock(0);

  const never = new AbortController().signal;

  const work = (async () => {
    await clock.sleepMs(100, never);
    await clock.sleepMs(100, never);

    return clock.readNowMs();
  })();

  void clock.sleepMs(1000, never);

  await clock.passSleepsUntilSettled(work);

  expect([await work, clock.readNowMs()]).toStrictEqual([200, 200]);
});

test('it throws when the test passes a sleep and none is waiting', () => {
  const clock = buildStubClock(0);

  expect(() => {
    clock.passNextSleep();
  }).toThrowWithMessage(Error, /no sleep is waiting/u);
});
