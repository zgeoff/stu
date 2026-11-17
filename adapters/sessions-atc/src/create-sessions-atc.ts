import { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import type { AtcAnswer, AtcReader, SessionSnapshot, SessionsPort } from '@stu/model';
import { match } from 'ts-pattern';
import { z } from 'zod';

// Only the fields the session kinds read, so a change to any other field leaves them working.
const LISTED_SESSION_SCHEMA = SESSION_DESCRIPTOR_SCHEMA.pick({
  id: true,
  name: true,
  state: true,
  lifecycle: true,
});

const SESSION_LIST_SCHEMA = z.object({ sessions: z.array(LISTED_SESSION_SCHEMA) });
const SESSION_GET_SCHEMA = z.object({ lastActivityAt: z.number() });

export function createSessionsAtc(atc: AtcReader): SessionsPort {
  return {
    listSessions: async () => {
      const listAnswer = await atc.read('/session/list', {});

      const listed = SESSION_LIST_SCHEMA.parse(
        parseAnswerBody('/session/list', listAnswer),
      ).sessions;

      return Promise.all(
        listed.map(async (session): Promise<SessionSnapshot> => {
          const getAnswer = await atc.read('/session/get', { session: session.id });

          return {
            id: session.id,
            name: session.name,
            state: session.state,
            desired: session.lifecycle.desired,
            harness: session.lifecycle.harness,
            lastActivityAt: SESSION_GET_SCHEMA.parse(parseAnswerBody('/session/get', getAnswer))
              .lastActivityAt,
          };
        }),
      );
    },
  };
}

// A kind that cannot read atc cannot look, so it throws, and the run opens its cannot-run fault.
function parseAnswerBody(path: string, answer: AtcAnswer): unknown {
  return match(answer)
    .with({ kind: 'answered' }, (answered) => answered.body)
    .with({ kind: 'refused' }, (refused) => {
      throw new Error(`atc refused ${path}: ${refused.code}`);
    })
    .with({ kind: 'unreached' }, (unreached) => {
      throw new Error(`atc read ${path} failed: ${unreached.reason}`);
    })
    .exhaustive();
}
