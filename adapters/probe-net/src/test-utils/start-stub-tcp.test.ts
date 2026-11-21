import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { startStubTCP } from './start-stub-tcp.ts';

test('it takes a connection on its port', async () => {
  const listener = startStubTCP();
  const socket = createConnection({ host: '127.0.0.1', port: listener.port });

  await once(socket, 'connect');

  const remotePort = socket.remotePort;

  socket.destroy();

  expect(remotePort).toBe(listener.port);
});

test('it takes no connection once stopped', async () => {
  const listener = startStubTCP();

  await listener.stop();

  const socket = createConnection({ host: '127.0.0.1', port: listener.port });

  const [error] = await once(socket, 'error');

  expect(error).toHaveProperty('code', 'ECONNREFUSED');
});
