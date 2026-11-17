import type { ReportedFault } from '@stu/model';
import { match } from 'ts-pattern';

// opening: stu is owed the open. open: stu has it. clearing: stu is owed the recovery. gone: the
// file holds no entry.
export type FaultPhase = 'opening' | 'open' | 'clearing' | 'gone';

export function getFaultPhase(fault: ReportedFault | undefined): FaultPhase {
  if (fault === undefined) {
    return 'gone';
  }

  return match(fault.owed)
    .with('open', () => 'opening' as const)
    .with('clear', () => 'clearing' as const)
    .with(null, () => 'open' as const)
    .exhaustive();
}
