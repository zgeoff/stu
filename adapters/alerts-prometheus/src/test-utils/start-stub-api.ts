import { makeAnswerQueue } from '@zgeoff/testing/helpers';

export interface StubRequest {
  readonly method: string;

  // the path and query string, such as "/v2/monitors?x=1"
  readonly target: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

// An HTTP server on a free local port. Each path answers with its responses in turn, and a path
// with no responses left, or none at all, answers 500. It records every request it gets.
export function startStubAPI(routes: Readonly<Record<string, readonly Response[]>>) {
  const queues = new Map(
    Object.entries(routes).map(([path, answers]) => [path, makeAnswerQueue(answers)]),
  );

  const requests: StubRequest[] = [];

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    requests.push({
      method: request.method,
      target: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(request.headers),
      body: await request.text(),
    });

    const next = queues.get(url.pathname);

    return next === undefined ? new Response(null, { status: 500 }) : next();
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: handleRequest,
    error: () => new Response(null, { status: 500 }),
  });

  return {
    url: server.url.href.replace(/\/$/u, ''),
    requests,
    stop: () => server.stop(true),
  };
}
