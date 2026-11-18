import { expect, onTestFinished, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { Reported } from '@stu/model';
import { makePrometheusAlertsKind } from './make-prometheus-alerts-kind.ts';
import { startStubAPI } from './test-utils/start-stub-api.ts';

function setupTest() {
  const file: { state: Reported } = { state: { faults: {}, lastRun: {} } };
  const notifier = buildStubNotifier([{ kind: 'sent' }]);
  const kind = makePrometheusAlertsKind();

  return {
    kind,
    notifier,
    runAt: async (at: string, grafanaURL: string) => {
      const result = await runWatch({
        checks: [
          {
            id: 'prometheus',
            kind: 'alerts-prometheus',
            everyMin: 1,
            grafanaURL,
            datasourceUID: 'prom-test',
            token: 'glsa_test_token',
          },
        ],
        kinds: { 'alerts-prometheus': kind },
        state: file.state,
        at: Temporal.Instant.from(at),
        notifier,
        writeReported: () => Promise.resolve(),
      });

      file.state = result.state;
    },
  };
}

test('it sends stu one open while an alert fires and one recovery once it stops', async () => {
  const ctx = setupTest();

  const grafana = startStubAPI({
    '/api/datasources/proxy/uid/prom-test/api/v1/query': [
      Response.json({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            {
              metric: {
                __name__: 'ALERTS',
                alertname: 'TargetDown',
                alertstate: 'firing',
                job: 'example',
                namespace: 'demo',
                severity: 'warning',
              },
              value: [1_794_900_000, '1'],
            },
          ],
        },
      }),
      Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
    ],
  });

  onTestFinished(() => grafana.stop());

  await ctx.runAt('2026-11-17T08:00:00Z', grafana.url);
  await ctx.runAt('2026-11-17T08:01:00Z', grafana.url);

  const key = 'prometheus:alertname="TargetDown",job="example",namespace="demo",severity="warning"';

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    `FAULT ${key}: Prometheus alert TargetDown (warning) is firing: job="example",namespace="demo"`,
    `RECOVERED ${key} (failing since 2026-11-17T08:00:00.000Z): Prometheus alert TargetDown (warning) is firing: job="example",namespace="demo"`,
  ]);
});

test('it sends no recovery and names only the status when Grafana answers 502 after an alert fired', async () => {
  const ctx = setupTest();

  const grafana = startStubAPI({
    '/api/datasources/proxy/uid/prom-test/api/v1/query': [
      Response.json({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [{ metric: { alertname: 'HostDown', instance: '192.0.2.7:9100' } }],
        },
      }),
      new Response('bad gateway at grafana.example.invalid', { status: 502 }),
    ],
  });

  onTestFinished(() => grafana.stop());

  await ctx.runAt('2026-11-17T08:00:00Z', grafana.url);
  await ctx.runAt('2026-11-17T08:01:00Z', grafana.url);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT prometheus:alertname="HostDown",instance="192.0.2.7:9100": Prometheus alert HostDown (no severity) is firing: instance="192.0.2.7:9100"',
    'FAULT prometheus: cannot run: grafana answered 502',
  ]);
});

test('it gives only the critical fault for an answer of Watchdog, InfoInhibitor, an inhibited info alert and a warning beside a critical', async () => {
  const ctx = setupTest();

  const grafana = startStubAPI({
    '/api/datasources/proxy/uid/prom-test/api/v1/query': [
      Response.json({
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            { metric: { alertname: 'Watchdog', severity: 'none' } },
            { metric: { alertname: 'InfoInhibitor', namespace: 'demo', severity: 'none' } },
            { metric: { alertname: 'CPUThrottlingHigh', namespace: 'demo', severity: 'info' } },
            { metric: { alertname: 'TargetDown', namespace: 'demo', severity: 'warning' } },
            { metric: { alertname: 'TargetDown', namespace: 'demo', severity: 'critical' } },
          ],
        },
      }),
    ],
  });

  onTestFinished(() => grafana.stop());

  const faults = await ctx.kind({
    grafanaURL: grafana.url,
    datasourceUID: 'prom-test',
    token: 'glsa_test_token',
  });

  expect(faults).toStrictEqual([
    {
      key: 'alertname="TargetDown",namespace="demo",severity="critical"',
      line: 'Prometheus alert TargetDown (critical) is firing: namespace="demo"',
    },
  ]);
});

test('it asks the proxy for the firing ALERTS with the token, trimming a trailing slash off the url', async () => {
  const ctx = setupTest();

  const grafana = startStubAPI({
    '/api/datasources/proxy/uid/prom-test/api/v1/query': [
      Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
    ],
  });

  onTestFinished(() => grafana.stop());

  await ctx.kind({
    grafanaURL: `${grafana.url}/`,
    datasourceUID: 'prom-test',
    token: 'glsa_test_token',
  });

  expect(grafana.requests).toStrictEqual([
    {
      method: 'GET',
      target: `/api/datasources/proxy/uid/prom-test/api/v1/query?query=ALERTS%7Balertstate%3D%22firing%22%7D`,
      headers: expect.objectContaining({ authorization: 'Bearer glsa_test_token' }),
      body: '',
    },
  ]);
});

test('it throws when the answer holds no Prometheus vector', () => {
  const ctx = setupTest();

  const grafana = startStubAPI({
    '/api/datasources/proxy/uid/prom-test/api/v1/query': [
      Response.json({ status: 'success', data: { resultType: 'matrix', result: [] } }),
    ],
  });

  onTestFinished(() => grafana.stop());

  const faults = ctx.kind({
    grafanaURL: grafana.url,
    datasourceUID: 'prom-test',
    token: 'glsa_test_token',
  });

  expect(faults).rejects.toThrowWithMessage(Error, 'grafana gave no Prometheus vector');
});

test('it throws without the url when Grafana gives no answer', async () => {
  const ctx = setupTest();
  const grafana = startStubAPI({});

  await grafana.stop();

  const faults = ctx.kind({
    grafanaURL: grafana.url,
    datasourceUID: 'prom-test',
    token: 'glsa_test_token',
  });

  expect(faults).rejects.toThrowWithMessage(Error, /^grafana gave no answer \(\w+\)$/u);
});
