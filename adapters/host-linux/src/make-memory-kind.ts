import type { Fault, HostPort, Kind } from '@stu/model';
import { z } from 'zod';
import { parseMeminfo } from './parse-meminfo.ts';
import { parseMemoryPressure } from './parse-memory-pressure.ts';

const MEMORY_PARAMS = z.object({
  // a fault below this share of memory available
  minAvailablePct: z.number().min(0).max(100),

  // a fault above this share of the last minute that every task waited on memory; left out, the
  // kind reads no pressure
  maxFullAvg60: z.number().min(0).max(100).optional(),
});

export function makeMemoryKind(host: HostPort): Kind {
  return async (params) => {
    const limits = MEMORY_PARAMS.parse(params);

    const meminfoText = await host.readMeminfo();

    const meminfo = parseMeminfo(meminfoText);
    const availablePct = (meminfo.availableKB / meminfo.totalKB) * 100;
    const faults: Fault[] = [];

    if (availablePct < limits.minAvailablePct) {
      faults.push({
        key: 'available',
        line: `memory available ${availablePct.toFixed(0)}% (${formatGiB(meminfo.availableKB)} of ${formatGiB(meminfo.totalKB)}), under ${limits.minAvailablePct}%`,
      });
    }

    if (limits.maxFullAvg60 !== undefined) {
      const pressureText = await host.readMemoryPressure();

      const fullAvg60 = parseMemoryPressure(pressureText);

      if (fullAvg60 > limits.maxFullAvg60) {
        faults.push({
          key: 'pressure',
          line: `memory pressure full avg60 ${fullAvg60}%, over ${limits.maxFullAvg60}%`,
        });
      }
    }

    return faults;
  };
}

function formatGiB(kilobytes: number): string {
  return `${(kilobytes / 1024 / 1024).toFixed(1)} GiB`;
}
