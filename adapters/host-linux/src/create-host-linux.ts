import { readFile } from 'node:fs/promises';
import type { HostPort } from '@stu/model';
import { $ } from 'bun';

export function createHostLinux(): HostPort {
  return {
    readMeminfo: () => readFile('/proc/meminfo', 'utf8'),
    readMemoryPressure: () => readFile('/proc/pressure/memory', 'utf8'),
    readDiskUsage: (paths) => $`df -P -k -- ${paths}`.quiet().text(),
  };
}
