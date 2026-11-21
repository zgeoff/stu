import type { FakeClock } from '@zgeoff/testing/clock';

// Lets the code run to its next sleep, then moves the clock to that sleep's end, until the work
// settles, whether it resolves or rejects. It waits on real I/O between sleeps by turning the event
// loop, so a test that can't settle ends at its test timeout.
export async function runClockUntilSettled(
  clock: FakeClock,
  work: Promise<unknown>,
): Promise<void> {
  const tracker = { isSettled: false };

  const trackWork = async () => {
    await Promise.allSettled([work]);

    tracker.isSettled = true;
  };

  void trackWork();

  await waitOneTurn();

  while (!tracker.isSettled) {
    const nextDueMs = clock.readNextDueMs();

    if (nextDueMs !== null) {
      clock.advance(nextDueMs - clock.now());
    }

    await waitOneTurn();
  }
}

function waitOneTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
