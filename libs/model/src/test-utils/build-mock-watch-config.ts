import type { WatchConfig } from '../watch-config-schema.ts';

export function buildMockWatchConfig(overrides: Partial<WatchConfig> = {}): WatchConfig {
  return {
    atc: { session: 's-stu' },
    statePath: 'reported.json',
    checks: [{ id: 'tunnel', kind: 'tcp', host: 'tunnel-a.example', port: 2222 }],
    ...overrides,
  };
}
