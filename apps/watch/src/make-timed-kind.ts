import { setTimeout as sleep } from 'node:timers/promises';
import type { Fault, Kind } from '@stu/model';

// The kind's own work keeps running past the timeout; the program exits at the end of the run,
// which stops it.
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

// node's sleep, not Bun.sleep: it takes an AbortSignal, so a kind that answers in time leaves no
// timer running.
async function rejectAfter(timeoutMs: number, signal: AbortSignal): Promise<readonly Fault[]> {
  await sleep(timeoutMs, undefined, { signal });

  throw new Error(`timed out after ${timeoutMs} ms`);
}
