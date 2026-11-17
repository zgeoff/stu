import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildMockDaemonRecord } from './build-mock-daemon-record.ts';
import type { DaemonRecord } from './build-mock-daemon-record.ts';

export interface DaemonRecordDeps {
  // atc's state folder, where its daemon writes daemon.json
  readonly stateFolder: string;
}

export async function seedDaemonRecord(
  deps: DaemonRecordDeps,
  input: Partial<DaemonRecord> = {},
): Promise<DaemonRecord> {
  const record = buildMockDaemonRecord(input);

  // The record a running atc daemon leaves in its state folder: atc writes it, and no code here does.
  await writeFile(join(deps.stateFolder, 'daemon.json'), JSON.stringify(record));

  return record;
}
