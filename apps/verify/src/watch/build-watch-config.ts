import type { WatchConfig } from '@stu/model';

// The watcher's config for one pass of the journey: one tcp check on the run's probe port, and every
// message to the run's inbox session.
export function buildWatchConfig(session: string, probePort: number): WatchConfig {
  return {
    atc: { session },
    statePath: 'stu-watch.reported.json',
    checks: [{ id: 'verify-port', kind: 'tcp', host: '127.0.0.1', port: probePort }],
  };
}
