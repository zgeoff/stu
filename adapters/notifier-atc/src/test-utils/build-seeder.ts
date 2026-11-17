import { buildDaemonRecordSeeder } from './build-daemon-record-seeder.ts';
import type { DaemonRecordDeps } from './seed-daemon-record.ts';

export type TestDeps = DaemonRecordDeps;

export function buildSeeder(deps: TestDeps) {
  return {
    ...buildDaemonRecordSeeder(deps),
  };
}
