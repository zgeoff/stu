import type { HostPort, Kind } from '@stu/model';
import { z } from 'zod';
import { parseDiskUsage } from './parse-disk-usage.ts';

const DISK_PARAMS = z.object({
  paths: z.array(z.string().min(1)).min(1),

  // a fault above this share of a filesystem in use
  maxUsedPct: z.number().min(0).max(100),
});

export function createDiskKind(host: HostPort): Kind {
  return async (params) => {
    const limits = DISK_PARAMS.parse(params);

    const dfText = await host.readDiskUsage(limits.paths);

    const usage = parseDiskUsage(dfText);

    return limits.paths.flatMap((path, index) => {
      const disk = usage[index];

      if (disk === undefined) {
        throw new Error(`df gave no line for ${path}`);
      }

      return disk.usedPct > limits.maxUsedPct
        ? [
            {
              key: path,
              line: `${path} is ${disk.usedPct}% full (${(disk.availableKB / 1024 / 1024).toFixed(1)} GiB free), over ${limits.maxUsedPct}%`,
            },
          ]
        : [];
    });
  };
}
