import type { DaemonRecord } from './build-mock-daemon-record.ts';
import { seedDaemonRecord } from './seed-daemon-record.ts';
import type { DaemonRecordDeps } from './seed-daemon-record.ts';

export function buildDaemonRecordSeeder(deps: DaemonRecordDeps) {
  return {
    daemonRecord: (input?: Partial<DaemonRecord>) => seedDaemonRecord(deps, input),
  };
}
