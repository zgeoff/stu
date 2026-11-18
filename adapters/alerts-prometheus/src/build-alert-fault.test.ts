import { expect, test } from 'bun:test';
import { buildAlertFault } from './build-alert-fault.ts';

test('it keys an alert by its labels sorted by name, without __name__ and alertstate', () => {
  const fault = buildAlertFault({
    severity: 'warning',
    __name__: 'ALERTS',
    namespace: 'demo',
    alertstate: 'firing',
    job: 'example',
    alertname: 'TargetDown',
  });

  expect(fault).toStrictEqual({
    key: 'alertname="TargetDown",job="example",namespace="demo",severity="warning"',
    line: 'Prometheus alert TargetDown (warning) is firing: job="example",namespace="demo"',
  });
});

test('it gives the same key whatever order the labels come in', () => {
  const first = buildAlertFault({ alertname: 'TargetDown', job: 'example', severity: 'warning' });
  const second = buildAlertFault({ severity: 'warning', job: 'example', alertname: 'TargetDown' });

  expect(second.key).toBe(first.key);
});

test('it writes no severity for an alert without one, and quotes a value that holds a quote', () => {
  const fault = buildAlertFault({ alertname: 'HostDown', instance: '192.0.2.7:9100 "a"' });

  expect(fault).toStrictEqual({
    key: String.raw`alertname="HostDown",instance="192.0.2.7:9100 \"a\""`,
    line: String.raw`Prometheus alert HostDown (no severity) is firing: instance="192.0.2.7:9100 \"a\""`,
  });
});

test('it ends the line at "is firing" for an alert with only an alertname and a severity', () => {
  const fault = buildAlertFault({ alertname: 'HostDown', severity: 'critical' });

  expect(fault.line).toBe('Prometheus alert HostDown (critical) is firing');
});
