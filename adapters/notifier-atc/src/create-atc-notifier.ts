import type { AtcAnswer, Notifier, SendOutcome } from '@stu/model';
import { match } from 'ts-pattern';
import type { AtcSocketClient } from './types.ts';

export interface AtcNotifierOptions {
  readonly client: AtcSocketClient;

  // the atc id of the session that gets each message
  readonly session: string;

  // the name atc labels a local program's message with
  readonly from: string;
}

// atc never runs a key again once it answers outcome_unknown or idempotency_conflict, so those
// two need a new key. Every other failure may have reached atc, and its key settles it on a resend.
export function createAtcNotifier(options: AtcNotifierOptions): Notifier {
  return {
    send: async (message) => {
      const answer = await options.client.write('/session/message', {
        session: options.session,
        text: message.text,
        from: options.from,
        idempotencyKey: message.idempotencyKey,
      });

      return match(answer)
        .returnType<Promise<SendOutcome> | SendOutcome>()
        .with({ kind: 'answered' }, () => ({ kind: 'sent' }))
        .with({ kind: 'unreached' }, (unreached) => ({
          kind: 'failed',
          reason: `atc send failed: ${unreached.reason}`,
        }))
        .with({ kind: 'refused', code: 'outcome_unknown' }, (refused) =>
          readUnknownOutcome(options, refused),
        )
        .with({ kind: 'refused', code: 'idempotency_conflict' }, () => ({
          kind: 'rekey',
          reason: `idempotency_conflict on ${message.idempotencyKey}`,
        }))
        .with({ kind: 'refused' }, (refused) => ({ kind: 'failed', reason: refused.code }))
        .exhaustive();
    },
  };
}

// The refusal holds the id atc minted for the message. A message stored under it counts as sent,
// and atc answers bad_args for one it does not hold.
async function readUnknownOutcome(
  options: AtcNotifierOptions,
  refused: Extract<AtcAnswer, { kind: 'refused' }>,
): Promise<SendOutcome> {
  const effectRef = refused.data['effectRef'];

  if (typeof effectRef !== 'string') {
    return { kind: 'failed', reason: 'outcome_unknown without an effectRef' };
  }

  const read = await options.client.read('/message/get', { message: effectRef });

  return match(read)
    .returnType<SendOutcome>()
    .with({ kind: 'answered' }, () => ({ kind: 'sent' }))
    .with({ kind: 'refused', code: 'bad_args' }, () => ({
      kind: 'rekey',
      reason: `outcome_unknown, and atc holds no ${effectRef}`,
    }))
    .with({ kind: 'refused' }, { kind: 'unreached' }, () => ({
      kind: 'failed',
      reason: 'outcome_unknown, and the message read failed',
    }))
    .exhaustive();
}
