import { startStubServer } from '@zgeoff/testing/server';

export interface StubGrafanaAnswer {
  // the bearer token the stub takes; any other gets a 401
  readonly token: string;

  // the labels of each firing alert, as Prometheus gives them
  readonly firing: readonly Readonly<Record<string, string>>[];
}

// An HTTP server on a free local port that answers every request that carries the token with a
// Prometheus vector of the firing alerts, whatever its path. The kit releases it after the test.
export function startStubGrafana(answer: StubGrafanaAnswer) {
  const server = startStubServer((request) => {
    if (request.headers.get('authorization') !== `Bearer ${answer.token}`) {
      return new Response(null, { status: 401 });
    }

    return Response.json({
      status: 'success',
      data: {
        resultType: 'vector',
        result: answer.firing.map((labels) => ({
          metric: { __name__: 'ALERTS', alertstate: 'firing', ...labels },
          value: [1_794_900_000, '1'],
        })),
      },
    });
  });

  return { url: server.url, stop: server.stop };
}
