import { setTimeout as sleep } from 'node:timers/promises';
import type { Fault, Kind } from '@stu/model';

// A kind that throws once it runs past the timeout, so the run opens its cannot-run fault. The
// kind's own work keeps running; the program exits at the end of the run, which stops it.
export function makeTimedKind(kind: Kind, timeoutMs: number): Kind {
  return async (params) => {
    const timer = new AbortController();

    try {
      return await Promise.race([kind(params), rejectAfter(timeoutMs, timer.signal)]);
    } finally {
      timer.abort();
    }
  };
}

async function rejectAfter(timeoutMs: number, signal: AbortSignal): Promise<readonly Fault[]> {
  await sleep(timeoutMs, undefined, { signal });

  throw new Error(`timed out after ${timeoutMs} ms`);
}
