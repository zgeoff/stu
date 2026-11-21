import { startStubServer } from '@zgeoff/testing/server';

// An HTTP server on a free local port that answers each request with the status and a redirect
// header, or never answers when the status is null. The kit releases it after the test.
export function startStubHTTP(status: number | null) {
  const server = startStubServer(() =>
    status === null
      ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(null, { status, headers: { location: '/elsewhere' } })),
  );

  return { port: Number(new URL(server.url).port), stop: server.stop };
}
