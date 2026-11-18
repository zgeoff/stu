import { runWatch } from '@stu/faults';
import type { WatchResult } from '@stu/faults';
import type { KindTable, Notifier, Reported, WatchConfig } from '@stu/model';
import { createTimedNotifier } from './create-timed-notifier.ts';
import { makeTimedKind } from './make-timed-kind.ts';
import type { SleepMs } from './make-timed-kind.ts';

export interface WatchOnce {
  readonly configPath: string;
  readonly kinds: KindTable;
  readonly at: Temporal.Instant;
  readonly createNotifier: (session: string) => Notifier;
  readonly readNowMs: () => number;
  readonly sleepMs: SleepMs;
  readonly readConfig: (configPath: string) => Promise<WatchConfig>;
  readonly readReported: (statePath: string) => Promise<Reported>;
  readonly writeReported: (statePath: string, next: Reported) => Promise<void>;
}

// A check that runs longer than this opens its cannot-run fault, well inside the service's own
// time limit, so a hung probe still lets the run send and exit.
const CHECK_TIMEOUT_MS = 30_000;

// No send starts later than this after the run starts, so a hung atc leaves the service's 50-second
// limit room for the sends already started. The run saves what it found before it sends.
const SEND_WINDOW_MS = 35_000;

export async function runWatchOnce(watch: WatchOnce): Promise<WatchResult> {
  const config = await watch.readConfig(watch.configPath);
  const state = await watch.readReported(config.statePath);

  return runWatch({
    checks: config.checks,
    kinds: Object.fromEntries(
      Object.entries(watch.kinds).map(([name, kind]) => [
        name,
        makeTimedKind(kind, CHECK_TIMEOUT_MS, watch.sleepMs),
      ]),
    ),
    state,
    at: watch.at,
    notifier: createTimedNotifier(watch.createNotifier(config.atc.session), {
      sendUntilMs: watch.at.epochMilliseconds + SEND_WINDOW_MS,
      readNowMs: watch.readNowMs,
    }),
    writeReported: (next) => watch.writeReported(config.statePath, next),
  });
}
