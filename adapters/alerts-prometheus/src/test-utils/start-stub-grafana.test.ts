import { expect, onTestFinished, test } from 'bun:test';
import { startStubGrafana } from './start-stub-grafana.ts';

async function setupTest(firing: readonly Readonly<Record<string, string>>[]) {
  const grafana = await startStubGrafana({ token: 'glsa_test_token', firing });

  onTestFinished(() => grafana.stop());

  return {
    readQuery: async (token: string) => {
      const response = await fetch(
        `${grafana.url}/api/datasources/proxy/uid/prom-test/api/v1/query`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );

      return { status: response.status, body: await response.text() };
    },
  };
}

test('it answers the token with a Prometheus vector of the firing alerts', async () => {
  const ctx = await setupTest([{ alertname: 'DiskFull', severity: 'critical' }]);
  const answer = await ctx.readQuery('glsa_test_token');

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
  const ctx = await setupTest([]);
  const answer = await ctx.readQuery('glsa_other_token');

  expect(answer).toStrictEqual({ status: 401, body: '' });
});
