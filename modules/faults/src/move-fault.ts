import type { Reported, ReportedFault } from '@stu/model';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { buildNextSendKey, buildSendKey } from './build-send-key.ts';

export type FaultMove =
  | {
      readonly to: 'opening';
      readonly check: string;
      readonly line: string;
      readonly since: string;
    }
  | { readonly to: 'open' }
  | { readonly to: 'clearing' }
  | { readonly to: 'gone' }

  // the owed send stays owed under the next send key, because atc will never run the current one
  | { readonly to: 'rekeyed' };

export function moveFault(reported: Reported, key: string, move: FaultMove): Reported {
  const held = reported.faults[key];
  const from = getFaultPhase(held);

  invariant(canMoveFault(from, move.to), `fault ${key} cannot move from ${from} to ${move.to}`);

  const { [key]: _, ...others } = reported.faults;

  return match(move)
    .with({ to: 'opening' }, (opening) => ({
      ...reported,
      faults: {
        ...others,
        [key]: {
          check: opening.check,
          line: opening.line,
          since: opening.since,
          owed: 'open' as const,
          sendKey: buildSendKey(key, 'open', opening.since),
        },
      },
    }))
    .with({ to: 'open' }, () => ({
      ...reported,
      faults: {
        ...reported.faults,
        [key]: { ...requireHeld(held), owed: null, sendKey: null },
      },
    }))
    .with({ to: 'clearing' }, () => {
      const fault = requireHeld(held);

      return {
        ...reported,
        faults: {
          ...reported.faults,
          [key]: {
            ...fault,
            owed: 'clear' as const,
            sendKey: buildSendKey(key, 'clear', fault.since),
          },
        },
      };
    })
    .with({ to: 'gone' }, () => ({ ...reported, faults: others }))
    .with({ to: 'rekeyed' }, () => {
      const fault = requireHeld(held);

      invariant(fault.sendKey !== null, `fault ${key} owes no send to rekey`);

      return {
        ...reported,
        faults: {
          ...reported.faults,
          [key]: { ...fault, sendKey: buildNextSendKey(fault.sendKey) },
        },
      };
    })
    .exhaustive();
}

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

const FAULT_MOVES: Readonly<Record<FaultPhase, readonly FaultMove['to'][]>> = {
  gone: ['opening'],
  opening: ['open', 'rekeyed'],
  open: ['clearing'],
  clearing: ['gone', 'rekeyed'],
};

function canMoveFault(from: FaultPhase, to: FaultMove['to']): boolean {
  return FAULT_MOVES[from].includes(to);
}

function requireHeld(fault: ReportedFault | undefined): ReportedFault {
  invariant(fault !== undefined, 'a held fault moves only from a held entry');

  return fault;
}
