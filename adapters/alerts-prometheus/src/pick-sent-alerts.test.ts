import { expect, test } from 'bun:test';
import { pickSentAlerts } from './pick-sent-alerts.ts';

test.each(['Watchdog', 'InfoInhibitor'])(
  'it drops %s, which Alertmanager never sends',
  (alertname) => {
    const sent = pickSentAlerts([{ alertname, severity: 'none' }]);

    expect(sent).toStrictEqual([]);
  },
);

test('it keeps only the critical alert of a namespace and alertname that also fires as warning and info', () => {
  const sent = pickSentAlerts([
    { alertname: 'TargetDown', namespace: 'demo', severity: 'warning' },
    { alertname: 'TargetDown', namespace: 'demo', severity: 'critical' },
    { alertname: 'TargetDown', namespace: 'demo', severity: 'info' },
  ]);

  expect(sent).toStrictEqual([
    { alertname: 'TargetDown', namespace: 'demo', severity: 'critical' },
  ]);
});

test('it drops an info alert beside a warning of the same namespace and alertname', () => {
  const sent = pickSentAlerts([
    { alertname: 'TargetDown', namespace: 'demo', severity: 'info' },
    { alertname: 'TargetDown', namespace: 'demo', severity: 'warning' },
  ]);

  expect(sent).toStrictEqual([{ alertname: 'TargetDown', namespace: 'demo', severity: 'warning' }]);
});

test('it keeps a warning beside a critical alert of another namespace', () => {
  const sent = pickSentAlerts([
    { alertname: 'TargetDown', namespace: 'demo', severity: 'warning' },
    { alertname: 'TargetDown', namespace: 'other', severity: 'critical' },
  ]);

  expect(sent).toStrictEqual([
    { alertname: 'TargetDown', namespace: 'demo', severity: 'warning' },
    { alertname: 'TargetDown', namespace: 'other', severity: 'critical' },
  ]);
});

test('it drops a warning beside a critical alert of the same alertname when both lack a namespace', () => {
  const sent = pickSentAlerts([
    { alertname: 'NodeDiskFull', severity: 'warning' },
    { alertname: 'NodeDiskFull', severity: 'critical' },
  ]);

  expect(sent).toStrictEqual([{ alertname: 'NodeDiskFull', severity: 'critical' }]);
});

test('it drops every info alert of a namespace where InfoInhibitor fires, and keeps info alerts elsewhere', () => {
  const sent = pickSentAlerts([
    { alertname: 'InfoInhibitor', namespace: 'demo', severity: 'none' },
    { alertname: 'CPUThrottlingHigh', namespace: 'demo', severity: 'info' },
    { alertname: 'CPUThrottlingHigh', namespace: 'other', severity: 'info' },
  ]);

  expect(sent).toStrictEqual([
    { alertname: 'CPUThrottlingHigh', namespace: 'other', severity: 'info' },
  ]);
});
