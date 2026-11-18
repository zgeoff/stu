import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WATCH_CONFIG_SCHEMA } from '@stu/model';
import type { WatchConfig } from '@stu/model';

// A relative state path is read from the config file's folder, so the timer's working folder
// doesn't decide where the reported file lives.
export async function readWatchConfig(path: string): Promise<WatchConfig> {
  const text = await readFile(path, 'utf8');

  const parsed: unknown = JSON.parse(text);
  const config = WATCH_CONFIG_SCHEMA.parse(parsed);

  return { ...config, statePath: resolve(dirname(path), config.statePath) };
}
