import type { Notifier } from '@stu/model';

export interface SendWindow {
  // the epoch milliseconds after which no send starts
  readonly sendUntilMs: number;
  readonly readNowMs: () => number;
}

// Without the window, a hung atc makes each owed send wait out its own timeout, and the run can
// outlive the service's time limit before it saves what it found.
export function createTimedNotifier(notifier: Notifier, window: SendWindow): Notifier {
  return {
    send: (message) =>
      window.readNowMs() < window.sendUntilMs
        ? notifier.send(message)
        : Promise.resolve({ kind: 'failed', reason: 'no time left in this run' }),
  };
}
