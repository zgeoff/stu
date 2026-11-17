import { runWatch } from '@stu/faults';
import type { WatchResult } from '@stu/faults';
import type { KindTable, Notifier } from '@stu/model';
import { readReported, writeReported } from '@stu/state-file';
import { makeTimedKind } from './make-timed-kind.ts';
import { readWatchConfig } from './read-watch-config.ts';

export interface WatchOnce {
  readonly configPath: string;
  readonly kinds: KindTable;
  readonly at: Temporal.Instant;
  readonly createNotifier: (session: string) => Notifier;
}

// A check that runs longer than this opens its cannot-run fault, well inside the service's own
// time limit, so a hung probe still lets the run send and exit.
const CHECK_TIMEOUT_MS = 30_000;

export async function runWatchOnce(watch: WatchOnce): Promise<WatchResult> {
  const config = await readWatchConfig(watch.configPath);
  const state = await readReported(config.statePath);

  return runWatch({
    checks: config.checks,
    kinds: Object.fromEntries(
      Object.entries(watch.kinds).map(([name, kind]) => [
        name,
        makeTimedKind(kind, CHECK_TIMEOUT_MS),
      ]),
    ),
    state,
    at: watch.at,
    notifier: watch.createNotifier(config.atc.session),
    writeReported: (next) => writeReported(config.statePath, next),
  });
}
