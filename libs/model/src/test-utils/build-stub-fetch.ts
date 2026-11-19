import { makeAnswerQueue } from '@zgeoff/testing/helpers';
import type { FetchHTTP } from '../types.ts';

export interface StubRequest {
  readonly method: string;

  // the path and query string, such as "/v2/monitors?x=1"
  readonly target: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

// 'hang' never answers, and rejects with the reason of the request's signal once it aborts, as fetch
// does.
type StubAnswer = Response | Error | 'hang';

// A fetch that answers each path, whatever the host, with its answers in turn. An Error answer
// rejects, as fetch does when no answer comes, and so does a path with no answers left or none at
// all. It records every request it gets.
export function buildStubFetch(routes: Readonly<Record<string, readonly StubAnswer[]>>) {
  const queues = new Map(
    Object.entries(routes).map(([path, answers]) => [path, makeAnswerQueue(answers)]),
  );

  const requests: StubRequest[] = [];

  const answerRequest: FetchHTTP = (url, init) => {
    requests.push({
      method: init.method ?? 'GET',
      target: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init.headers)),
      body: typeof init.body === 'string' ? init.body : '',
    });

    return Promise.try(() => takeAnswer(queues, url, init.signal));
  };

  return { fetch: answerRequest, requests };
}

function takeAnswer(
  queues: ReadonlyMap<string, () => StubAnswer>,
  url: URL,
  signal: AbortSignal | null | undefined,
): Response | Promise<Response> {
  const next = queues.get(url.pathname);

  if (next === undefined) {
    throw new Error(`the stub fetch has no answers for ${url.pathname}`);
  }

  const answer = next();

  if (answer instanceof Error) {
    throw answer;
  }

  if (answer === 'hang') {
    return hangUntilAborted(signal);
  }

  return answer;
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  const hung = Promise.withResolvers<Response>();

  signal?.addEventListener('abort', () => {
    hung.reject(signal.reason);
  });

  return hung.promise;
}
