import type { Fault } from '@stu/model';
import type { SlotUsage, WindowUsage } from './parse-usage-headers.ts';

export interface SlotLines {
  readonly fivePct: number;
  readonly sevenPct: number;
}

// One fault for a slot over either window's line, or null.
export function buildSlotFault(slotID: string, usage: SlotUsage, lines: SlotLines): Fault | null {
  const windows = [
    { name: '5-hour', usage: usage.fiveHour, linePct: lines.fivePct },
    { name: '7-day', usage: usage.sevenDay, linePct: lines.sevenPct },
  ];

  // The line is divided rather than the use multiplied: 0.57 * 100 is 56.99999999999999, while
  // 57 / 100 is the same double as 0.57.
  const over = windows.filter((window) => window.usage.fraction >= window.linePct / 100);

  if (over.length === 0) {
    return null;
  }

  return {
    key: slotID,
    line: `Claude slot ${slotID} is over its limit: ${over.map((window) => formatWindow(window.name, window.usage, window.linePct)).join('; ')}`,
  };
}

function formatWindow(name: string, usage: WindowUsage, linePct: number): string {
  const resets = usage.resetsAt === null ? '' : `, resets ${usage.resetsAt}`;

  return `${name} ${Math.round(usage.fraction * 100)}% (line ${linePct}%${resets})`;
}
