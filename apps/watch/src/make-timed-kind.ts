import type { Fault, Kind } from '@stu/model';
import type { Clock } from '@zgeoff/std';

// The kind's own work keeps running past the timeout; the program exits at the end of the run,
// which stops it.
export function makeTimedKind(kind: Kind, timeoutMs: number, clock: Pick<Clock, 'sleep'>): Kind {
  return async (params) => {
    const timer = new AbortController();

    try {
      return await Promise.race([kind(params), rejectAfter(timeoutMs, timer.signal, clock)]);
    } finally {
      timer.abort();
    }
  };
}

async function rejectAfter(
  timeoutMs: number,
  signal: AbortSignal,
  clock: Pick<Clock, 'sleep'>,
): Promise<readonly Fault[]> {
  await clock.sleep(timeoutMs, signal);

  // The sleep resolves when the signal aborts, which happens once the race is over, so a loser
  // that has not timed out settles no more.
  if (signal.aborted) {
    return new Promise<never>(() => {});
  }

  throw new Error(`timed out after ${timeoutMs} ms`);
}
