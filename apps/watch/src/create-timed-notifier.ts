import type { Notifier, SendOutcome } from '@stu/model';
import type { Clock } from '@zgeoff/std';

export interface SendWindow {
  // the epoch milliseconds after which no send starts
  readonly sendUntilMs: number;

  // the epoch milliseconds at which a send still running is cut
  readonly sendsEndMs: number;
  readonly clock: Pick<Clock, 'now' | 'sleep'>;
}

// Without the window, a hung atc makes each owed send wait out its own timeouts, and the run can
// outlive the service's time limit before it saves what it found. A cut send answers failed, so it
// stays owed under its key, and the next run's resend replays it if atc took it.
export function createTimedNotifier(notifier: Notifier, window: SendWindow): Notifier {
  return {
    send: async (message) => {
      const nowMs = window.clock.now();

      if (nowMs >= window.sendUntilMs) {
        return { kind: 'failed', reason: 'no time left in this run' };
      }

      const timer = new AbortController();

      try {
        return await Promise.race([
          notifier.send(message),
          failAfter(window.sendsEndMs - nowMs, timer.signal, window.clock),
        ]);
      } finally {
        timer.abort();
      }
    },
  };
}

async function failAfter(
  durationMs: number,
  signal: AbortSignal,
  clock: Pick<Clock, 'sleep'>,
): Promise<SendOutcome> {
  await clock.sleep(durationMs, signal);

  // The sleep resolves when the signal aborts, which happens once the race is over, so a loser
  // that has not timed out settles no more.
  if (signal.aborted) {
    return new Promise<never>(() => {});
  }

  return { kind: 'failed', reason: 'atc send ran past the end of the run' };
}
