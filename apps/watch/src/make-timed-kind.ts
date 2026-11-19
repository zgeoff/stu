import type { Fault, Kind, SleepMs } from '@stu/model';

// The kind's own work keeps running past the timeout; the program exits at the end of the run,
// which stops it.
export function makeTimedKind(kind: Kind, timeoutMs: number, sleepMs: SleepMs): Kind {
  return async (params) => {
    const timer = new AbortController();

    try {
      return await Promise.race([kind(params), rejectAfter(timeoutMs, timer.signal, sleepMs)]);
    } finally {
      timer.abort();
    }
  };
}

async function rejectAfter(
  timeoutMs: number,
  signal: AbortSignal,
  sleepMs: SleepMs,
): Promise<readonly Fault[]> {
  await sleepMs(timeoutMs, signal);

  throw new Error(`timed out after ${timeoutMs} ms`);
}
