import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostPort } from '@stu/model';
import { $ } from 'bun';

export interface HostLinuxOptions {
  // the folder the kernel's proc files are under: /proc on a host
  readonly procRoot: string;
}

export function createHostLinux(options: HostLinuxOptions): HostPort {
  return {
    readMeminfo: () => readFile(join(options.procRoot, 'meminfo'), 'utf8'),
    readMemoryPressure: () => readFile(join(options.procRoot, 'pressure', 'memory'), 'utf8'),
    readDiskUsage: (paths) => $`df -P -k -- ${paths}`.quiet().text(),
  };
}
