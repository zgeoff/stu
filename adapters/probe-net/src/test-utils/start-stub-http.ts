import { once } from 'node:events';
import { createServer } from 'node:http';
import { readListenPort } from './read-listen-port.ts';

// An HTTP server on a free local port that answers each request with the status and a redirect
// header, or never answers when the status is null.
export async function startStubHTTP(status: number | null) {
  const server = createServer((_request, response) => {
    if (status !== null) {
      response.writeHead(status, { location: '/elsewhere' }).end();
    }
  });

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  return {
    port: readListenPort(server),
    stop: async () => {
      server.closeAllConnections();
      server.close();

      await once(server, 'close');
    },
  };
}
