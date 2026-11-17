import type { ReportedFault } from '@stu/model';
import { match } from 'ts-pattern';

export function formatFaultMessage(
  key: string,
  fault: Extract<ReportedFault, { owed: 'open' | 'clear' }>,
): string {
  return match(fault.owed)
    .with('open', () => `FAULT ${key}: ${fault.line}`)
    .with('clear', () => `RECOVERED ${key} (failing since ${fault.since}): ${fault.line}`)
    .exhaustive();
}
