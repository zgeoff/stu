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

  return { key, moves };
}

test.each<[FaultPhase, FaultMove['to'][], FaultMove['to'], FaultPhase]>([
  ['gone', [], 'opening', 'opening'],
  ['opening', ['opening'], 'open', 'open'],
  ['opening', ['opening'], 'rekeyed', 'opening'],
  ['open', ['opening', 'open'], 'clearing', 'clearing'],
  ['clearing', ['opening', 'open', 'clearing'], 'gone', 'gone'],
  ['clearing', ['opening', 'open', 'clearing'], 'rekeyed', 'clearing'],
])('it moves a fault from %s (reached by %p) by %s, to %s', (from, steps, move, to) => {
  const ctx = setupTest();

  const start = steps.reduce<Reported>((file, step) => moveFault(file, ctx.key, ctx.moves[step]), {
    faults: {},
    lastRun: {},
  });

  const moved = moveFault(start, ctx.key, ctx.moves[move]);

  expect(getFaultPhase(start.faults[ctx.key])).toBe(from);
  expect(getFaultPhase(moved.faults[ctx.key])).toBe(to);
});

test.each<[FaultPhase, FaultMove['to'][], FaultMove['to']]>([
  ['gone', [], 'open'],
  ['gone', [], 'clearing'],
  ['gone', [], 'gone'],
  ['gone', [], 'rekeyed'],
  ['opening', ['opening'], 'opening'],
  ['opening', ['opening'], 'clearing'],
  ['opening', ['opening'], 'gone'],
  ['open', ['opening', 'open'], 'opening'],
  ['open', ['opening', 'open'], 'open'],
  ['open', ['opening', 'open'], 'gone'],
  ['open', ['opening', 'open'], 'rekeyed'],
  ['clearing', ['opening', 'open', 'clearing'], 'opening'],
  ['clearing', ['opening', 'open', 'clearing'], 'open'],
  ['clearing', ['opening', 'open', 'clearing'], 'clearing'],
])('it refuses to move a fault from %s (reached by %p) to %s', (from, steps, to) => {
  const ctx = setupTest();

  const start = steps.reduce<Reported>((file, step) => moveFault(file, ctx.key, ctx.moves[step]), {
    faults: {},
    lastRun: {},
  });

  expect(getFaultPhase(start.faults[ctx.key])).toBe(from);

  expect(() => moveFault(start, ctx.key, ctx.moves[to])).toThrow(
    `fault ${ctx.key} cannot move from ${from} to ${to}`,
  );
});

test('it gives a rekeyed fault the next send key', () => {
  const ctx = setupTest();
  const opening = moveFault({ faults: {}, lastRun: {} }, ctx.key, ctx.moves.opening);
  const sendKey = opening.faults[ctx.key]?.sendKey;
  const rekeyed = moveFault(opening, ctx.key, ctx.moves.rekeyed);

  expect(rekeyed.faults[ctx.key]?.sendKey).toBe(`${String(sendKey)}:2`);
});
