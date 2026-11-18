import invariant from 'tiny-invariant';
import type { SleepMs } from '../types.ts';

interface WaitingSleep {
  readonly endMs: number;
  readonly pass: () => void;
}

// A clock that moves only when the test passes a sleep. Each sleep waits until the test passes it,
// and rejects with its signal's reason once the signal aborts.
export function buildStubClock(startMs: number) {
  let nowMs = startMs;

  const waiting = new Set<WaitingSleep>();

  const sleepMs: SleepMs = (durationMs, signal) => {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }

    const sleep = Promise.withResolvers<void>();
    const entry = { endMs: nowMs + durationMs, pass: sleep.resolve };

    waiting.add(entry);

    signal.addEventListener('abort', () => {
      waiting.delete(entry);
      sleep.reject(signal.reason);
    });

    return sleep.promise;
  };

  // ends the sleep that ends first, the first asked of a tie, and moves the clock to its end
  const passNextSleep = () => {
    const [next] = [...waiting].toSorted((first, second) => first.endMs - second.endMs);

    invariant(next !== undefined, 'no sleep is waiting');

    waiting.delete(next);

    nowMs = next.endMs;

    next.pass();
  };

  // Lets the code run up to its next sleep, then passes that sleep, until the work settles. Code
  // that waits on real I/O between sleeps needs passNextSleep, since this can't wait on it.
  const passSleepsUntilSettled = async (work: Promise<unknown>) => {
    const tracker = { isSettled: false };

    const trackWork = async () => {
      await Promise.allSettled([work]);

      tracker.isSettled = true;
    };

    void trackWork();

    await waitForPendingCallbacks();

    while (!tracker.isSettled) {
      passNextSleep();

      await waitForPendingCallbacks();
    }
  };

  return { readNowMs: () => nowMs, sleepMs, passNextSleep, passSleepsUntilSettled };
}

function waitForPendingCallbacks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
