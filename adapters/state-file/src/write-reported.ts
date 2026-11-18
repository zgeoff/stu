import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Reported } from '@stu/model';

// The rename replaces the file whole, so a run killed mid-write leaves the last good file.
export async function writeReported(path: string, reported: Reported): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, `${JSON.stringify(reported, null, 2)}\n`);
  await rename(temp, path);
}
