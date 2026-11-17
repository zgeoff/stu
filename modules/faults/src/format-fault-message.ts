import type { ReportedFault } from '@stu/model';

export function formatFaultMessage(key: string, fault: ReportedFault): string {
  return fault.owed === 'clear'
    ? `RECOVERED ${key} (failing since ${fault.since}): ${fault.line}`
    : `FAULT ${key}: ${fault.line}`;
}
