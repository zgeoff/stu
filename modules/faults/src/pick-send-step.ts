import type { Reported, SendOutcome } from '@stu/model';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { buildNextSendKey } from './build-send-key.ts';
import { moveFault } from './move-fault.ts';

// What a key's owed send came to, and the file that follows. failed keeps the send key; resend and
// gave-up hold the next key, saved before its send, and gave-up has no try left this run.
export type SendStep =
  | { readonly kind: 'sent'; readonly state: Reported }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'resend'; readonly state: Reported }
  | { readonly kind: 'gave-up'; readonly state: Reported; readonly reason: string };

// triesLeft counts this send among the tries.
export function pickSendStep(
  reported: Reported,
  key: string,
  outcome: SendOutcome,
  triesLeft: number,
): SendStep {
  const fault = reported.faults[key];

  invariant(fault !== undefined && fault.sendKey !== null, `fault ${key} owes no send`);

  const sendKey = fault.sendKey;

  return match(outcome)
    .returnType<SendStep>()
    .with({ kind: 'sent' }, () => ({
      kind: 'sent',
      state: moveFault(reported, key, { to: fault.owed === 'open' ? 'open' : 'gone' }),
    }))
    .with({ kind: 'failed' }, (failed) => ({ kind: 'failed', reason: failed.reason }))
    .with({ kind: 'rekey' }, (rekey) => {
      const state = {
        ...reported,
        faults: { ...reported.faults, [key]: { ...fault, sendKey: buildNextSendKey(sendKey) } },
      };

      return triesLeft > 1
        ? { kind: 'resend', state }
        : { kind: 'gave-up', state, reason: rekey.reason };
    })
    .exhaustive();
}
