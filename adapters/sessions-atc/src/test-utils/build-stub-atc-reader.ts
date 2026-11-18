import { createORPCClient } from '@orpc/client';
import type { AtcProcedures, AtcReader } from '@stu/model';
import { z } from 'zod';

const GET_INPUT_SCHEMA = z.object({ session: z.string() });

// An atc reader that answers session.list with the list answer and session.get with the answer
// recorded for the session it names, through oRPC's client, as the socket client calls atc.
export function buildStubAtcReader(
  listAnswer: unknown,
  getAnswers: Readonly<Record<string, unknown>>,
): AtcReader {
  const procedures = createORPCClient<AtcProcedures>({
    call: (path, input) => {
      const procedure = path.join('.');

      const answer =
        procedure === 'session.list'
          ? listAnswer
          : getAnswers[GET_INPUT_SCHEMA.parse(input).session];

      return answer === undefined
        ? Promise.reject(new Error(`no recorded answer for ${procedure}`))
        : Promise.resolve(answer);
    },
  });

  return {
    read: async (call) => ({ kind: 'answered', body: await call(procedures) }),
  };
}
