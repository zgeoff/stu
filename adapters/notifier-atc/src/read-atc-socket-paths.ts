import { readFile } from 'node:fs/promises';
import { resolveAtcPaths } from '@atcx/contract/light';
import { z } from 'zod';
import type { AtcSocketPaths } from './types.ts';

// The client sockets to try, in order. atc's daemon puts its sockets under $XDG_RUNTIME_DIR as its
// own environment has it, which can differ from this process's, such as under a systemd user unit,
// so atc's clients also try the socket that the daemon's record holds.
export async function readAtcSocketPaths(
  env: Readonly<Record<string, string | undefined>>,
): Promise<AtcSocketPaths> {
  const paths = resolveAtcPaths(env);

  const recorded = await readRecordedSocketPath(paths.daemonRecordFile);

  return recorded === null || recorded === paths.daemonSocketPath
    ? [paths.daemonSocketPath]
    : [paths.daemonSocketPath, recorded];
}

const DAEMON_RECORD_SCHEMA = z.object({ socketPath: z.string().min(1) });
const READ_ERROR_SCHEMA = z.object({ code: z.string() });

async function readRecordedSocketPath(recordFile: string): Promise<string | null> {
  let text: string;

  try {
    text = await readFile(recordFile, 'utf8');
  } catch (error) {
    // a daemon that never ran leaves no record
    if (READ_ERROR_SCHEMA.safeParse(error).data?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  let record: unknown;

  // a daemon cut off mid-write leaves a torn record, which atc's own clients skip too
  try {
    record = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = DAEMON_RECORD_SCHEMA.safeParse(record);

  return parsed.success ? parsed.data.socketPath : null;
}
