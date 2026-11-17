import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { readListenPort } from './read-listen-port.ts';

// A TCP server on a free local port that takes each connection and closes it.
export async function startStubTCP() {
  const sockets = new Set<Socket>();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.end();
  });

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  return {
    port: readListenPort(server),
    stop: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      server.close();

      await once(server, 'close');
    },
  };
}
