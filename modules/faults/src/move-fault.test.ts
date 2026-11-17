import { expect, test } from 'bun:test';
import type { Reported } from '@stu/model';
import { getFaultPhase, moveFault } from './move-fault.ts';
import type { FaultMove, FaultPhase } from './move-fault.ts';

function setupTest() {
  const key = 'tunnel:a:22';

  const moves: Readonly<Record<FaultPhase, FaultMove>> = {
    opening: {
      to: 'opening',
      check: 'tunnel',
      line: 'no answer from a:22',
      since: '2026-11-17T08:00:00.000Z',
    },
    open: { to: 'open' },
    clearing: { to: 'clearing' },
    gone: { to: 'gone' },
  };

  // The phases a fault passes through, in order, from an empty file.
  const path: readonly FaultPhase[] = ['opening', 'open', 'clearing'];

  return {
    key,
    moves,

    // The file with the fault in the phase, reached by moving it from an empty file.
    reach: (phase: FaultPhase): Reported => {
      const steps = phase === 'gone' ? [] : path.slice(0, path.indexOf(phase) + 1);

      return steps.reduce<Reported>((reported, step) => moveFault(reported, key, moves[step]), {
        faults: {},
        lastRun: {},
      });
    },
  };
}

test.each<[FaultPhase, FaultPhase]>([
  ['gone', 'opening'],
  ['opening', 'open'],
  ['open', 'clearing'],
  ['clearing', 'gone'],
])('it moves a fault from %s to %s', (from, to) => {
  const ctx = setupTest();
  const moved = moveFault(ctx.reach(from), ctx.key, ctx.moves[to]);

  expect(getFaultPhase(moved.faults[ctx.key])).toBe(to);
});

test.each<[FaultPhase, FaultPhase]>([
  ['gone', 'open'],
  ['gone', 'clearing'],
  ['gone', 'gone'],
  ['opening', 'opening'],
  ['opening', 'clearing'],
  ['opening', 'gone'],
  ['open', 'opening'],
  ['open', 'open'],
  ['open', 'gone'],
  ['clearing', 'opening'],
  ['clearing', 'open'],
  ['clearing', 'clearing'],
])('it refuses to move a fault from %s to %s', (from, to) => {
  const ctx = setupTest();
  const reported = ctx.reach(from);

  expect(() => moveFault(reported, ctx.key, ctx.moves[to])).toThrow(
    `fault ${ctx.key} cannot move from ${from} to ${to}`,
  );
});
