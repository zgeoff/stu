import type { Notifier, SendOutcome, SleepMs } from '@stu/model';

export interface SendWindow {
  // the epoch milliseconds after which no send starts
  readonly sendUntilMs: number;

  // the epoch milliseconds at which a send still running is cut
  readonly sendsEndMs: number;
  readonly readNowMs: () => number;
  readonly sleepMs: SleepMs;
}

// Without the window, a hung atc makes each owed send wait out its own timeouts, and the run can
// outlive the service's time limit before it saves what it found. A cut send answers failed, so it
// stays owed under its key, and the next run's resend replays it if atc took it.
export function createTimedNotifier(notifier: Notifier, window: SendWindow): Notifier {
  return {
    send: async (message) => {
      const nowMs = window.readNowMs();

      if (nowMs >= window.sendUntilMs) {
        return { kind: 'failed', reason: 'no time left in this run' };
      }

      const timer = new AbortController();

      try {
        return await Promise.race([
          notifier.send(message),
          failAfter(window.sendsEndMs - nowMs, timer.signal, window.sleepMs),
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
  sleepMs: SleepMs,
): Promise<SendOutcome> {
  await sleepMs(durationMs, signal);

  return { kind: 'failed', reason: 'atc send ran past the end of the run' };
}
