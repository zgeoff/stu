import { expect, test } from 'bun:test';
import type { Reported } from '@stu/model';
import { getFaultPhase } from './get-fault-phase.ts';
import type { FaultPhase } from './get-fault-phase.ts';
import { moveFault } from './move-fault.ts';
import type { FaultMove } from './move-fault.ts';

test.each<{ from: FaultPhase; steps: FaultMove['to'][]; move: FaultMove['to']; to: FaultPhase }>([
  { from: 'gone', steps: [], move: 'opening', to: 'opening' },
  { from: 'opening', steps: ['opening'], move: 'open', to: 'open' },
  { from: 'opening', steps: ['opening'], move: 'rekeyed', to: 'opening' },
  { from: 'open', steps: ['opening', 'open'], move: 'clearing', to: 'clearing' },
  { from: 'clearing', steps: ['opening', 'open', 'clearing'], move: 'gone', to: 'gone' },
  { from: 'clearing', steps: ['opening', 'open', 'clearing'], move: 'rekeyed', to: 'clearing' },
])('it moves a fault from $from (reached by $steps) by $move, to $to', (row) => {
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

  const start = row.steps.reduce<Reported>((file, step) => moveFault(file, key, moves[step]), {
    faults: {},
    lastRun: {},
  });

  const moved = moveFault(start, key, moves[row.move]);

  expect(getFaultPhase(moved.faults[key])).toBe(row.to);
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

  const start = steps.reduce<Reported>((file, step) => moveFault(file, key, moves[step]), {
    faults: {},
    lastRun: {},
  });

  expect(() => moveFault(start, key, moves[to])).toThrow(
    `fault ${key} cannot move from ${from} to ${to}`,
  );
});

test('it gives a rekeyed fault the next send key', () => {
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

  const opening = moveFault({ faults: {}, lastRun: {} }, key, moves.opening);
  const sendKey = opening.faults[key]?.sendKey;
  const rekeyed = moveFault(opening, key, moves.rekeyed);

  expect(rekeyed.faults[key]?.sendKey).toBe(`${String(sendKey)}:2`);
});
