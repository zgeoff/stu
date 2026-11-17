import { setTimeout as sleep } from 'node:timers/promises';
import type { CheckConfig, Fault, KindTable, Notifier, Reported } from '@stu/model';
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
  readonly checkTimeoutMs: number;
  readonly notifier: Notifier;
  readonly writeReported: (next: Reported) => Promise<void>;
}

export interface WatchResult {
  readonly state: Reported;
  readonly sent: number;
  readonly failedSends: number;
}

interface Ledger {
  state: Reported;
  sent: number;
  failedSends: number;
}

// One run: every due check, then each send owed from an earlier run, then the sends this run's
// changes owe, one message per change.
export async function runWatch(run: WatchRun): Promise<WatchResult> {
  const due = run.checks.filter((check) =>
    isDue(check, run.state.lastRun[check.id], run.at.epochMilliseconds),
  );

  const outcomes = await Promise.all(
    due.map((check) => runCheck(check, run.kinds, run.checkTimeoutMs)),
  );

  const ledger: Ledger = { state: run.state, sent: 0, failedSends: 0 };

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

async function runCheck(
  check: CheckConfig,
  kinds: KindTable,
  timeoutMs: number,
): Promise<CheckOutcome> {
  const { id, kind: kindName, everyMin: _, ...params } = check;
  const kind = kinds[kindName];

  if (kind === undefined) {
    return { kind: 'threw', check: id, reason: `no kind named ${kindName}` };
  }

  const timer = new AbortController();

  try {
    const faults = await Promise.race([kind(params), rejectAfter(timeoutMs, timer.signal)]);

    return { kind: 'ran', check: id, faults };
  } catch (error) {
    return { kind: 'threw', check: id, reason: formatReason(error) };
  } finally {
    timer.abort();
  }
}

async function rejectAfter(timeoutMs: number, signal: AbortSignal): Promise<readonly Fault[]> {
  await sleep(timeoutMs, undefined, { signal });

  throw new Error(`timed out after ${timeoutMs} ms`);
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
    .with({ kind: 'failed' }, () => {
      ledger.failedSends += 1;

      return Promise.resolve();
    })
    .with({ kind: 'rekey' }, async () => {
      ledger.state = {
        ...ledger.state,
        faults: { ...ledger.state.faults, [key]: { ...fault, sendKey: buildNextSendKey(sendKey) } },
      };

      await run.writeReported(ledger.state);

      if (triesLeft > 1) {
        await writeOwedMessage(run, ledger, key, triesLeft - 1);
      } else {
        ledger.failedSends += 1;
      }
    })
    .exhaustive();
}
