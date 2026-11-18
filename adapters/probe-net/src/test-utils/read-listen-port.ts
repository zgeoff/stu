import type { Server } from 'node:net';

export function readListenPort(server: Server): number {
  const address = server.address();

  if (typeof address !== 'object' || address === null) {
    throw new Error('the server listens on no port');
  }

  return address.port;
}
