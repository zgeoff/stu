import type { Fault } from '@stu/model';
import type { SlotUsage } from './parse-usage-headers.ts';

// One fault for a slot whose 7-day use is at or over its line, or null.
export function buildSlotFault(slotID: string, usage: SlotUsage, sevenPct: number): Fault | null {
  // The line is divided rather than the use multiplied: 0.57 * 100 is 56.99999999999999, while
  // 57 / 100 is the same double as 0.57.
  if (usage.fraction < sevenPct / 100) {
    return null;
  }

  const resets = usage.resetsAt === null ? '' : `, resets ${usage.resetsAt}`;

  return {
    key: slotID,
    line: `Claude slot ${slotID} is over its limit: 7-day ${Math.round(usage.fraction * 100)}% (line ${sevenPct}%${resets})`,
  };
}
