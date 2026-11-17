import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { startStubTCP } from './start-stub-tcp.ts';

test('it takes a connection on its port and closes it', async () => {
  const listener = await startStubTCP();

  onTestFinished(() => listener.stop());

  const socket = createConnection({ host: '127.0.0.1', port: listener.port });

  await once(socket, 'close');

  expect(socket.bytesRead).toBe(0);
});
