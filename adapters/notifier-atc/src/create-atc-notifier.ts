import { MESSAGE_ANSWER_SCHEMA } from '@atcx/contract';
import type { Notifier, OwedMessage, SendOutcome } from '@stu/model';
import { match } from 'ts-pattern';
import { AtcError } from './atc-error.ts';
import type { AtcSocketClient } from './types.ts';

export interface AtcNotifierOptions {
  readonly client: AtcSocketClient;

  // the atc id of the session that gets each message
  readonly session: string;

  // the name atc labels a local program's message with
  readonly from: string;
}

export function createAtcNotifier(options: AtcNotifierOptions): Notifier {
  return {
    send: async (message) => {
      try {
        const answer = await options.client.write('/session/message', {
          session: options.session,
          text: message.text,
          from: options.from,
          idempotencyKey: message.idempotencyKey,
        });

        MESSAGE_ANSWER_SCHEMA.parse(answer);

        return { kind: 'sent' };
      } catch (error) {
        return readRefusalOutcome(options, message, error);
      }
    },
  };
}

// atc never runs a key again once it answers outcome_unknown or idempotency_conflict, so those
// two need a new key. Every other failure may have reached atc, and its key settles it on a resend.
function readRefusalOutcome(
  options: AtcNotifierOptions,
  message: OwedMessage,
  error: unknown,
): Promise<SendOutcome> | SendOutcome {
  if (!(error instanceof AtcError)) {
    return { kind: 'failed', reason: `atc send failed: ${formatCause(error)}` };
  }

  return match(error.code)
    .returnType<Promise<SendOutcome> | SendOutcome>()
    .with('outcome_unknown', () => readUnknownOutcome(options, error))
    .with('idempotency_conflict', () => ({
      kind: 'rekey',
      reason: `idempotency_conflict on ${message.idempotencyKey}`,
    }))
    .otherwise(() => ({ kind: 'failed', reason: error.code }));
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The error holds the id atc minted for the message. A message stored under it counts as sent.
async function readUnknownOutcome(
  options: AtcNotifierOptions,
  error: AtcError,
): Promise<SendOutcome> {
  const effectRef = error.data['effectRef'];

  if (typeof effectRef !== 'string') {
    return { kind: 'failed', reason: 'outcome_unknown without an effectRef' };
  }

  try {
    await options.client.read('/message/get', { message: effectRef });

    return { kind: 'sent' };
  } catch (readError) {
    // atc answers bad_args for a message it does not hold
    return readError instanceof AtcError && readError.code === 'bad_args'
      ? { kind: 'rekey', reason: `outcome_unknown, and atc holds no ${effectRef}` }
      : { kind: 'failed', reason: 'outcome_unknown, and the message read failed' };
  }
}
