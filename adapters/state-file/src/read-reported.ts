import { readFile } from 'node:fs/promises';
import { REPORTED_SCHEMA } from '@stu/model';
import type { Reported } from '@stu/model';

// A file that is not there yet reads as a watcher that has told stu nothing.
export async function readReported(path: string): Promise<Reported> {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return { faults: {}, lastRun: {} };
    }

    throw error;
  }

  const parsed: unknown = JSON.parse(text);

  return REPORTED_SCHEMA.parse(parsed);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
