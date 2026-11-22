import { runWatch } from '@stu/faults';
import type { WatchResult } from '@stu/faults';
import type {
  KindTable,
  Notifier,
  NotifierTable,
  Reported,
  SecretsPort,
  WatchConfig,
} from '@stu/model';
import type { Clock } from '@zgeoff/std';
import { buildSecretKinds } from './build-secret-kinds.ts';
import { createTimedNotifier } from './create-timed-notifier.ts';
import { makeTimedKind } from './make-timed-kind.ts';

export interface WatchOnce {
  readonly configPath: string;
  readonly kinds: KindTable;
  readonly at: Temporal.Instant;
  readonly notifiers: NotifierTable;
  readonly secrets: SecretsPort;
  readonly clock: Pick<Clock, 'now' | 'sleep'>;
  readonly readConfig: (configPath: string) => Promise<WatchConfig>;
  readonly readReported: (statePath: string) => Promise<Reported>;
  readonly writeReported: (statePath: string, next: Reported) => Promise<void>;
}

// A check that runs longer than this opens its cannot-run fault, well inside the service's own
// time limit, so a hung probe still lets the run send and exit.
const CHECK_TIMEOUT_MS = 30_000;

// No send starts 35 seconds into the run, and a send still running at 45 seconds is cut, so a hung
// atc leaves the service's 50-second limit room to save what the run found, which it saves after it
// resends what earlier runs owe.
const SEND_WINDOW_MS = 35_000;
const SENDS_END_MS = 45_000;

export async function runWatchOnce(watch: WatchOnce): Promise<WatchResult> {
  const config = await watch.readConfig(watch.configPath);

  const notifier = createNotifier(watch.notifiers, config.notify);

  const state = await watch.readReported(config.statePath);

  // The timeout wraps the secret reads, so a hung op read opens the check's cannot-run fault too.
  const kinds = buildSecretKinds(watch.kinds, watch.secrets);

  return runWatch({
    checks: config.checks,
    kinds: Object.fromEntries(
      Object.entries(kinds).map(([name, kind]) => [
        name,
        makeTimedKind(kind, CHECK_TIMEOUT_MS, watch.clock),
      ]),
    ),
    state,
    at: watch.at,
    notifier: createTimedNotifier(notifier, {
      sendUntilMs: watch.at.epochMilliseconds + SEND_WINDOW_MS,
      sendsEndMs: watch.at.epochMilliseconds + SENDS_END_MS,
      clock: watch.clock,
    }),
    writeReported: (next) => watch.writeReported(config.statePath, next),
  });
}

// No check runs without a notifier to tell stu what it found, so an unknown kind fails the run.
function createNotifier(notifiers: NotifierTable, notify: WatchConfig['notify']): Notifier {
  const { kind, ...params } = notify;
  const makeNotifier = Object.hasOwn(notifiers, kind) ? notifiers[kind] : undefined;

  if (makeNotifier === undefined) {
    throw new Error(`no notifier kind named ${kind}`);
  }

  return makeNotifier(params);
}
