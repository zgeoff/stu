import { expect, test } from 'bun:test';
import { buildSlotFault } from './build-slot-fault.ts';

test('it gives one fault keyed by the slot id for a 7-day use of 0.86 over a line of 85', () => {
  const fault = buildSlotFault('slot-b', { fraction: 0.86, resetsAt: '2026-11-21T10:20:00Z' }, 85);

  expect(fault).toStrictEqual({
    key: 'slot-b',
    line: 'Claude slot slot-b is over its limit: 7-day 86% (line 85%, resets 2026-11-21T10:20:00Z)',
  });
});

test('it gives no fault for a 7-day use of 0.50 under a line of 85', () => {
  const fault = buildSlotFault('slot-a', { fraction: 0.5, resetsAt: null }, 85);

  expect(fault).toBeNull();
});

test('it gives a fault for a 7-day use of 0.57 exactly at a line of 57', () => {
  const fault = buildSlotFault('slot-d', { fraction: 0.57, resetsAt: null }, 57);

  expect(fault).toStrictEqual({
    key: 'slot-d',
    line: 'Claude slot slot-d is over its limit: 7-day 57% (line 57%)',
  });
});
