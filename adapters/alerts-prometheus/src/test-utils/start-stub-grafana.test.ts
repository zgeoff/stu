import { expect, test } from 'bun:test';
import { startStubGrafana } from './start-stub-grafana.ts';

function setupTest() {
  return {
    startGrafana: (firing: readonly Readonly<Record<string, string>>[]) =>
      startStubGrafana({ token: 'glsa_test_token', firing }),
    readQuery: async (url: string, token: string) => {
      const response = await fetch(`${url}/api/datasources/proxy/uid/prom-test/api/v1/query`, {
        headers: { authorization: `Bearer ${token}` },
      });

      return { status: response.status, body: await response.text() };
    },
  };
}

test('it answers the token with a Prometheus vector of the firing alerts', async () => {
  const ctx = setupTest();
  const grafana = ctx.startGrafana([{ alertname: 'DiskFull', severity: 'critical' }]);

  const answer = await ctx.readQuery(grafana.url, 'glsa_test_token');

  const body: unknown = JSON.parse(answer.body);

  expect({ status: answer.status, body }).toStrictEqual({
    status: 200,
    body: {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          {
            metric: {
              __name__: 'ALERTS',
              alertstate: 'firing',
              alertname: 'DiskFull',
              severity: 'critical',
            },
            value: [1_794_900_000, '1'],
          },
        ],
      },
    },
  });
});

test('it answers 401 to another token', async () => {
  const ctx = setupTest();
  const grafana = ctx.startGrafana([]);

  const answer = await ctx.readQuery(grafana.url, 'glsa_other_token');

  expect(answer).toStrictEqual({ status: 401, body: '' });
});
