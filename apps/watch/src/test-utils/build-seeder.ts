import { buildDaemonRecordSeeder } from '@stu/notifier-atc/test-utils/build-daemon-record-seeder';
import { buildWatchConfigSeeder } from './build-watch-config-seeder.ts';

export interface TestDeps {
  // the folder the watch config goes in
  readonly folder: string;

  // atc's state folder, where its daemon writes daemon.json
  readonly stateFolder: string;
}

export function buildSeeder(deps: TestDeps) {
  return {
    ...buildWatchConfigSeeder({ folder: deps.folder }),
    ...buildDaemonRecordSeeder({ stateFolder: deps.stateFolder }),
  };
}
