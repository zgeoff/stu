import type { OwedMessage, SendOutcome } from '@stu/model';
import { makeRepeatingAnswerQueue } from '@zgeoff/testing/mocks';

// A notifier that records each message and answers with each outcome in turn, then the last again.
export function buildStubNotifier(outcomes: readonly [SendOutcome, ...SendOutcome[]]) {
  const next = makeRepeatingAnswerQueue(outcomes);
  const sent: OwedMessage[] = [];

  return {
    sent,
    send: (message: OwedMessage): Promise<SendOutcome> => {
      sent.push(message);

      return Promise.resolve(next());
    },
  };
}
