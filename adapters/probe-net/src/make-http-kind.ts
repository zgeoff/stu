import type { Kind, NetPort } from '@stu/model';
import { match } from 'ts-pattern';
import { z } from 'zod';

const HTTP_PARAMS = z.object({
  url: z.url(),

  // the one status that counts as up; left out, any status under 400 does
  status: z.number().int().optional(),
});

export function makeHTTPKind(net: NetPort): Kind {
  return async (params) => {
    const target = HTTP_PARAMS.parse(params);
    const url = target.url;

    const answer = await net.readHTTP(url, { timeoutMs: 10_000 });

    return match(answer)
      .with({ kind: 'answered' }, (answered) =>
        isUp(answered.status, target.status)
          ? []
          : [{ key: url, line: `GET ${url} answered ${answered.status}` }],
      )
      .with({ kind: 'unreached' }, (unreached) => [
        { key: url, line: `GET ${url} got no answer: ${unreached.reason}` },
      ])
      .exhaustive();
  };
}

function isUp(answered: number, expected: number | undefined): boolean {
  return expected === undefined ? answered < 400 : answered === expected;
}
