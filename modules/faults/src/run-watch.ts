import type { CheckConfig, KindTable, Notifier, Reported } from '@stu/model';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { buildNextSendKey } from './build-send-key.ts';
import { formatFaultMessage } from './format-fault-message.ts';
import { isDue } from './is-due.ts';
import { moveFault } from './move-fault.ts';
import { pickChanges } from './pick-changes.ts';
import type { CheckOutcome } from './pick-changes.ts';

export interface WatchRun {
  readonly checks: readonly CheckConfig[];
  readonly kinds: KindTable;
  readonly state: Reported;
  readonly at: Temporal.Instant;
  readonly notifier: Notifier;
  readonly writeReported: (next: Reported) => Promise<void>;
}

// A send that stays owed, with the fault key and why atc did not take it.
export interface SendFailure {
  readonly key: string;
  readonly reason: string;
}

export interface WatchResult {
  readonly state: Reported;
  readonly sent: number;
  readonly failures: readonly SendFailure[];
}

interface Ledger {
  state: Reported;
  sent: number;
  failures: SendFailure[];
}

export async function runWatch(run: WatchRun): Promise<WatchResult> {
  const due = run.checks.filter((check) =>
    isDue(check, run.state.lastRun[check.id], run.at.epochMilliseconds),
  );

  const outcomes = await Promise.all(due.map((check) => runCheck(check, run.kinds)));

  const ledger: Ledger = { state: run.state, sent: 0, failures: [] };

  for (const key of collectOwedKeys(run.state)) {
    await writeOwedMessage(run, ledger, key);
  }

  const stillOwed = collectOwedKeys(ledger.state);

  const next = pickChanges(ledger.state, {
    outcomes,
    checkIDs: run.checks.map((check) => check.id),
    at: run.at.toString({ smallestUnit: 'millisecond' }),
  });

  if (JSON.stringify(next) !== JSON.stringify(ledger.state)) {
    ledger.state = next;

    await run.writeReported(next);
  }

  for (const key of collectOwedKeys(next).filter((owed) => !stillOwed.includes(owed))) {
    await writeOwedMessage(run, ledger, key);
  }

  return ledger;
}

async function runCheck(check: CheckConfig, kinds: KindTable): Promise<CheckOutcome> {
  const { id, kind: kindName, everyMin: _, ...params } = check;
  const kind = kinds[kindName];

  if (kind === undefined) {
    return { kind: 'threw', check: id, reason: `no kind named ${kindName}` };
  }

  try {
    const faults = await kind(params);

    return { kind: 'ran', check: id, faults };
  } catch (error) {
    return { kind: 'threw', check: id, reason: formatReason(error) };
  }
}

// The first line of the error, cut to a length that fits one message line.
function formatReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  return (text.split('\n')[0] ?? '').slice(0, 200);
}

function collectOwedKeys(reported: Reported): string[] {
  return Object.entries(reported.faults)
    .filter(([, fault]) => fault.owed !== null)
    .map(([key]) => key);
}

const MAX_TRIES = 2;

// Sends what the key owes under its stored key. When atc will never run that key, the next key is
// saved before the send that uses it, so a lost reply to that send replays on the next run.
async function writeOwedMessage(
  run: WatchRun,
  ledger: Ledger,
  key: string,
  triesLeft = MAX_TRIES,
): Promise<void> {
  const fault = ledger.state.faults[key];

  invariant(fault !== undefined && fault.sendKey !== null, `fault ${key} owes no send`);

  const sendKey = fault.sendKey;

  const outcome = await run.notifier.send({
    text: formatFaultMessage(key, fault),
    idempotencyKey: sendKey,
  });

  await match(outcome)
    .with({ kind: 'sent' }, async () => {
      ledger.state = moveFault(ledger.state, key, { to: fault.owed === 'open' ? 'open' : 'gone' });
      ledger.sent += 1;

      await run.writeReported(ledger.state);
    })
    .with({ kind: 'failed' }, (failed) => {
      ledger.failures.push({ key, reason: failed.reason });

      return Promise.resolve();
    })
    .with({ kind: 'rekey' }, async (rekey) => {
      ledger.state = {
        ...ledger.state,
        faults: { ...ledger.state.faults, [key]: { ...fault, sendKey: buildNextSendKey(sendKey) } },
      };

      await run.writeReported(ledger.state);

      if (triesLeft > 1) {
        await writeOwedMessage(run, ledger, key, triesLeft - 1);
      } else {
        ledger.failures.push({ key, reason: rekey.reason });
      }
    })
    .exhaustive();
}
