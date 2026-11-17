import { runWatch } from '@stu/faults';
import type { WatchResult } from '@stu/faults';
import type { KindTable, Notifier } from '@stu/model';
import { readReported, writeReported } from '@stu/state-file';
import { readWatchConfig } from './read-watch-config.ts';

export interface WatchOnce {
  readonly configPath: string;
  readonly kinds: KindTable;
  readonly at: Temporal.Instant;
  readonly createNotifier: (session: string) => Notifier;
}

// A check that runs longer than this opens its cannot-run fault, so one hung probe can't hold
// back the run past the next timer tick.
const CHECK_TIMEOUT_MS = 30_000;

export async function runWatchOnce(watch: WatchOnce): Promise<WatchResult> {
  const config = await readWatchConfig(watch.configPath);
  const state = await readReported(config.statePath);

  return runWatch({
    checks: config.checks,
    kinds: watch.kinds,
    state,
    at: watch.at,
    checkTimeoutMs: CHECK_TIMEOUT_MS,
    notifier: watch.createNotifier(config.atc.session),
    writeReported: (next) => writeReported(config.statePath, next),
  });
}
