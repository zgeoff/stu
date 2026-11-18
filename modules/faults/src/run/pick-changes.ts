import type { Fault, Reported } from '@stu/model';
import { match } from 'ts-pattern';
import { findOwn } from '../find-own.ts';
import { getFaultPhase } from '../state/get-fault-phase.ts';
import { moveFault } from '../state/move-fault.ts';

// What a due check came to on this run. A check that wasn't due has no outcome.
export type CheckOutcome =
  | { readonly kind: 'ran'; readonly check: string; readonly faults: readonly Fault[] }
  | { readonly kind: 'threw'; readonly check: string; readonly reason: string };

export interface RunFindings {
  readonly outcomes: readonly CheckOutcome[];

  // the ids of every check in the config, due or not
  readonly checkIDs: readonly string[];

  // ISO time of the run
  readonly at: string;
}

// The next reported file, from the faults each due check saw. A key that still owes a send is
// left as it is, so its owed message settles before anything new is decided for it.
export function pickChanges(reported: Reported, findings: RunFindings): Reported {
  const ran = findings.outcomes.reduce(
    (next, outcome) => pickCheckChanges(next, outcome, findings.at),
    pickLastRun(reported, findings),
  );

  return Object.entries(ran.faults)
    .filter(([, fault]) => !findings.checkIDs.includes(fault.check))
    .reduce((next, [key]) => pickClearIfOpen(next, key), ran);
}

function pickCheckChanges(reported: Reported, outcome: CheckOutcome, at: string): Reported {
  return match(outcome)
    .with({ kind: 'ran' }, (ran) => pickRanChanges(reported, ran, at))
    .with({ kind: 'threw' }, (threw) =>
      findOwn(reported.faults, threw.check) === undefined
        ? moveFault(reported, threw.check, {
            to: 'opening',
            check: threw.check,
            line: `cannot run: ${threw.reason}`,
            since: at,
          })
        : reported,
    )
    .exhaustive();
}

function pickRanChanges(
  reported: Reported,
  ran: Extract<CheckOutcome, { kind: 'ran' }>,
  at: string,
): Reported {
  const seen = new Map<string, string>();

  for (const fault of ran.faults) {
    const key = `${ran.check}:${fault.key}`;

    if (!seen.has(key)) {
      seen.set(key, fault.line);
    }
  }

  const cleared = Object.entries(reported.faults)
    .filter(([key, fault]) => fault.check === ran.check && !seen.has(key))
    .reduce((next, [key]) => pickClearIfOpen(next, key), reported);

  return [...seen]
    .filter(([key]) => findOwn(cleared.faults, key) === undefined)
    .reduce(
      (next, [key, line]) =>
        moveFault(next, key, { to: 'opening', check: ran.check, line, since: at }),
      cleared,
    );
}

// A fault whose open stu may not have yet keeps owing it: its recovery waits for atc to take the
// open, because the open may have reached stu with its reply lost.
function pickClearIfOpen(reported: Reported, key: string): Reported {
  return match(getFaultPhase(findOwn(reported.faults, key)))
    .with('open', () => moveFault(reported, key, { to: 'clearing' }))
    .with('opening', 'clearing', 'gone', () => reported)
    .exhaustive();
}

function pickLastRun(reported: Reported, findings: RunFindings): Reported {
  const kept = Object.entries(reported.lastRun).filter(([check]) =>
    findings.checkIDs.includes(check),
  );

  const ranNow = findings.outcomes.map((outcome) => [outcome.check, findings.at] as const);

  return { ...reported, lastRun: Object.fromEntries([...kept, ...ranNow]) };
}
