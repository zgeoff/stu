import type { WatchConfig } from '@stu/model';
import { seedWatchConfig } from './seed-watch-config.ts';
import type { WatchConfigDeps } from './seed-watch-config.ts';

export function buildWatchConfigSeeder(deps: WatchConfigDeps) {
  return {
    watchConfig: (input?: Partial<WatchConfig>) => seedWatchConfig(deps, input),
  };
}
