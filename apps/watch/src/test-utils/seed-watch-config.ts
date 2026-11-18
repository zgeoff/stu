import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WatchConfig } from '@stu/model';
import { buildMockWatchConfig } from '@stu/model/test-utils/build-mock-watch-config';

export interface WatchConfigDeps {
  // the folder the config file goes in
  readonly folder: string;
}

// Gives the config file's path.
export async function seedWatchConfig(
  deps: WatchConfigDeps,
  input: Partial<WatchConfig> = {},
): Promise<string> {
  const configPath = join(deps.folder, 'stu-watch.config.json');

  // The config the owner writes by hand: no code here writes it.
  await writeFile(configPath, JSON.stringify(buildMockWatchConfig(input)));

  return configPath;
}
