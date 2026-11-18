import { expect, test } from 'bun:test';
import { buildSlotFault } from './build-slot-fault.ts';

test('it gives one fault keyed by the slot id for a 5-hour use of 0.92 over a line of 90', () => {
  const fault = buildSlotFault(
    'slot-a',
    {
      fiveHour: { fraction: 0.92, resetsAt: '2026-11-17T10:20:00Z' },
      sevenDay: { fraction: 0.5, resetsAt: null },
    },
    { fivePct: 90, sevenPct: 85 },
  );

  expect(fault).toStrictEqual({
    key: 'slot-a',
    line: 'Claude slot slot-a is over its limit: 5-hour 92% (line 90%, resets 2026-11-17T10:20:00Z)',
  });
});

test('it gives no fault for a use of 0.50 in both windows', () => {
  const fault = buildSlotFault(
    'slot-a',
    { fiveHour: { fraction: 0.5, resetsAt: null }, sevenDay: { fraction: 0.5, resetsAt: null } },
    { fivePct: 90, sevenPct: 85 },
  );

  expect(fault).toBeNull();
});

test('it gives one fault for a 7-day use of 0.86 over a line of 85', () => {
  const fault = buildSlotFault(
    'slot-b',
    { fiveHour: { fraction: 0.1, resetsAt: null }, sevenDay: { fraction: 0.86, resetsAt: null } },
    { fivePct: 90, sevenPct: 85 },
  );

  expect(fault).toStrictEqual({
    key: 'slot-b',
    line: 'Claude slot slot-b is over its limit: 7-day 86% (line 85%)',
  });
});

test('it gives one fault naming both windows when both are over', () => {
  const fault = buildSlotFault(
    'slot-c',
    { fiveHour: { fraction: 0.95, resetsAt: null }, sevenDay: { fraction: 0.9, resetsAt: null } },
    { fivePct: 90, sevenPct: 85 },
  );

  expect(fault).toStrictEqual({
    key: 'slot-c',
    line: 'Claude slot slot-c is over its limit: 5-hour 95% (line 90%); 7-day 90% (line 85%)',
  });
});

test.each([
  { window: '7-day', usage: { five: 0.1, seven: 0.57 }, lines: { fivePct: 90, sevenPct: 57 } },
  { window: '5-hour', usage: { five: 0.9, seven: 0.1 }, lines: { fivePct: 90, sevenPct: 85 } },
])('it gives a fault for a $window use exactly at its line', (row) => {
  const fault = buildSlotFault(
    'slot-d',
    {
      fiveHour: { fraction: row.usage.five, resetsAt: null },
      sevenDay: { fraction: row.usage.seven, resetsAt: null },
    },
    row.lines,
  );

  expect(fault).toStrictEqual({ key: 'slot-d', line: expect.any(String) });
});
