import { readFile } from 'node:fs/promises';
import { resolveAtcPaths } from '@atcx/contract/light';
import { z } from 'zod';

// The client sockets to try, in order. atc's daemon puts its sockets under $XDG_RUNTIME_DIR as its
// own environment has it, which can differ from this process's, such as under a systemd user unit,
// so atc's clients also try the socket that the daemon's record holds.
export async function readAtcSocketPaths(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const paths = resolveAtcPaths(env);

  const recorded = await readRecordedSocketPath(paths.daemonRecordFile);

  return recorded === null || recorded === paths.daemonSocketPath
    ? [paths.daemonSocketPath]
    : [paths.daemonSocketPath, recorded];
}

const DAEMON_RECORD_SCHEMA = z.object({ socketPath: z.string().min(1) });

async function readRecordedSocketPath(recordFile: string): Promise<string | null> {
  let record: unknown;

  // a daemon that never ran leaves no record, and one cut off mid-write leaves a torn one
  try {
    const text = await readFile(recordFile, 'utf8');

    record = JSON.parse(text);
  } catch {
    return null;
  }

  const parsed = DAEMON_RECORD_SCHEMA.safeParse(record);

  return parsed.success ? parsed.data.socketPath : null;
}
