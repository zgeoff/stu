import { startStubServer } from '@zgeoff/testing/server';

// A server on a free local port that takes each connection. The kit releases it after the test.
export function startStubTCP() {
  const server = startStubServer(() => new Response(null, { status: 204 }));

  return { port: Number(new URL(server.url).port), stop: server.stop };
}
