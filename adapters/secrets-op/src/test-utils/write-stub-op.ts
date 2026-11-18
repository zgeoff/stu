import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StubOp {
  // the service account token the stub needs in OP_SERVICE_ACCOUNT_TOKEN
  readonly serviceAccountToken: string;

  // what `op read <reference>` prints for each reference it holds
  readonly values: Readonly<Record<string, string>>;
}

// Writes an `op` program into <folder>/bin and gives that folder, for the front of a PATH. The stub
// prints the value of a reference it holds, and exits 1 for any other reference or another token.
export async function writeStubOp(folder: string, stub: StubOp): Promise<string> {
  const binFolder = join(folder, 'bin');

  const cases = Object.entries(stub.values)
    .map(([ref, value]) => `  ${toShellWord(ref)}) printf '%s\\n' ${toShellWord(value)} ;;`)
    .join('\n');

  await mkdir(binFolder, { recursive: true });

  await writeFile(
    join(binFolder, 'op'),
    [
      '#!/bin/sh',
      `[ "$1" = read ] && [ "$OP_SERVICE_ACCOUNT_TOKEN" = ${toShellWord(stub.serviceAccountToken)} ] || exit 1`,
      'case "$2" in',
      cases,
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'),
  );

  await chmod(join(binFolder, 'op'), 0o755);

  return binFolder;
}

function toShellWord(text: string): string {
  return `'${text.replaceAll("'", String.raw`'\''`)}'`;
}
