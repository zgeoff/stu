import type { WatchConfig } from '@stu/model';

export function buildWatchConfig(session: string, probePort: number): WatchConfig {
  return {
    notify: { kind: 'atc', session },
    statePath: 'stu-watch.reported.json',
    checks: [{ id: 'verify-port', kind: 'tcp', host: '127.0.0.1', port: probePort }],
  };
}
