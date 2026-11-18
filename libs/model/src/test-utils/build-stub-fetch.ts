import { makeAnswerQueue } from '@zgeoff/testing/helpers';
import type { FetchHTTP } from '../types.ts';

export interface StubRequest {
  readonly method: string;

  // the path and query string, such as "/v2/monitors?x=1"
  readonly target: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

// A fetch that answers each path, whatever the host, with its answers in turn. An Error answer
// rejects, as fetch does when no answer comes, and so does a path with no answers left or none at
// all. It records every request it gets.
export function buildStubFetch(routes: Readonly<Record<string, readonly (Response | Error)[]>>) {
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

    const next = queues.get(url.pathname);

    if (next === undefined) {
      return Promise.reject(new Error(`the stub fetch has no answers for ${url.pathname}`));
    }

    try {
      const answer = next();

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return { fetch: answerRequest, requests };
}
