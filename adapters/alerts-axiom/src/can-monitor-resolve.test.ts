import { expect, test } from 'bun:test';
import { canMonitorResolve } from './can-monitor-resolve.ts';

test.each(['Threshold', 'AnomalyDetection'] as const)('it reads an enabled %s monitor', (type) => {
  expect(canMonitorResolve({ type })).toBeTrue();
});

test.each([
  { case: 'a MatchEvent monitor', monitor: { type: 'MatchEvent' as const } },
  { case: 'a disabled monitor', monitor: { type: 'Threshold' as const, disabled: true } },
  {
    case: 'a monitor that skips resolved notices',
    monitor: { type: 'Threshold' as const, skipResolved: true },
  },
])('it skips $case', (row) => {
  expect(canMonitorResolve(row.monitor)).toBeFalse();
});
