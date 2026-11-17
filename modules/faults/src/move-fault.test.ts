import { expect, test } from 'bun:test';
import { moveFault } from './move-fault.ts';

test('it refuses to clear a fault whose open stu does not have yet', () => {
  const opening = moveFault({ faults: {}, lastRun: {} }, 'tunnel:a:22', {
    to: 'opening',
    check: 'tunnel',
    line: 'no answer from a:22',
    since: '2026-11-17T08:00:00.000Z',
  });

  expect(() => moveFault(opening, 'tunnel:a:22', { to: 'clearing' })).toThrow('cannot move');
});

test('it refuses to open a fault the file already holds', () => {
  const move = {
    to: 'opening',
    check: 'tunnel',
    line: 'no answer from a:22',
    since: '2026-11-17T08:00:00.000Z',
  } as const;

  const opening = moveFault({ faults: {}, lastRun: {} }, 'tunnel:a:22', move);

  expect(() => moveFault(opening, 'tunnel:a:22', move)).toThrow('cannot move');
});
