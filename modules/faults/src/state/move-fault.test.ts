import { expect, test } from 'bun:test';
import type { Reported } from '@stu/model';
import { getFaultPhase } from './get-fault-phase.ts';
import type { FaultPhase } from './get-fault-phase.ts';
import { moveFault } from './move-fault.ts';
import type { FaultMove } from './move-fault.ts';

function setupTest() {
  const key = 'tunnel:a:22';

  const moves: Readonly<Record<FaultMove['to'], FaultMove>> = {
    opening: {
      to: 'opening',
      check: 'tunnel',
      line: 'no answer from a:22',
      since: '2026-11-17T08:00:00.000Z',
    },
    open: { to: 'open' },
    clearing: { to: 'clearing' },
    gone: { to: 'gone' },
    rekeyed: { to: 'rekeyed' },
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

test.each<[FaultPhase, FaultMove['to'], FaultPhase]>([
  ['gone', 'opening', 'opening'],
  ['opening', 'open', 'open'],
  ['opening', 'rekeyed', 'opening'],
  ['open', 'clearing', 'clearing'],
  ['clearing', 'gone', 'gone'],
  ['clearing', 'rekeyed', 'clearing'],
])('it moves a fault from %s by %s, to %s', (from, move, to) => {
  const ctx = setupTest();
  const moved = moveFault(ctx.reach(from), ctx.key, ctx.moves[move]);

  expect(getFaultPhase(moved.faults[ctx.key])).toBe(to);
});

test.each<[FaultPhase, FaultMove['to']]>([
  ['gone', 'open'],
  ['gone', 'clearing'],
  ['gone', 'gone'],
  ['gone', 'rekeyed'],
  ['opening', 'opening'],
  ['opening', 'clearing'],
  ['opening', 'gone'],
  ['open', 'opening'],
  ['open', 'open'],
  ['open', 'gone'],
  ['open', 'rekeyed'],
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

test('it gives a rekeyed fault the next send key', () => {
  const ctx = setupTest();
  const opening = ctx.reach('opening');
  const sendKey = opening.faults[ctx.key]?.sendKey;
  const rekeyed = moveFault(opening, ctx.key, ctx.moves.rekeyed);

  expect(rekeyed.faults[ctx.key]?.sendKey).toBe(`${String(sendKey)}:2`);
});
