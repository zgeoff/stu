import type { CheckConfig } from '@stu/model';

// A timer that fires a little early still counts as a full interval.
const SLACK_MS = 5000;

export function isDue(check: CheckConfig, lastRun: string | undefined, atMs: number): boolean {
  if (lastRun === undefined || check.everyMin === undefined) {
    return true;
  }

  const lastRunMs = Temporal.Instant.from(lastRun).epochMilliseconds;

  return atMs - lastRunMs >= check.everyMin * 60_000 - SLACK_MS;
}
