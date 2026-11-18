import { once } from 'node:events';
import { createServer } from 'node:http';

export interface StubGrafanaAnswer {
  // the bearer token the stub takes; any other gets a 401
  readonly token: string;

  // the labels of each firing alert, as Prometheus gives them
  readonly firing: readonly Readonly<Record<string, string>>[];
}

// An HTTP server on a free local port that answers every request that carries the token with a
// Prometheus vector of the firing alerts, whatever its path.
export async function startStubGrafana(answer: StubGrafanaAnswer) {
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${answer.token}`) {
      response.writeHead(401).end();

      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        status: 'success',
        data: {
          resultType: 'vector',
          result: answer.firing.map((labels) => ({
            metric: { __name__: 'ALERTS', alertstate: 'firing', ...labels },
            value: [1_794_900_000, '1'],
          })),
        },
      }),
    );
  });

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (typeof address !== 'object' || address === null) {
    throw new Error('the stub Grafana listens on no port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      server.closeAllConnections();
      server.close();

      await once(server, 'close');
    },
  };
}
