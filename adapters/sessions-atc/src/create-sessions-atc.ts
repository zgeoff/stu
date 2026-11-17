import { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import type { AtcReader, SessionSnapshot, SessionsPort } from '@stu/model';
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

// Reads every session through /session/list, then each one's last activity through /session/get.
export function createSessionsAtc(atc: AtcReader): SessionsPort {
  return {
    listSessions: async () => {
      const listAnswer = await atc.read('/session/list', {});

      const listed = SESSION_LIST_SCHEMA.parse(listAnswer).sessions;

      return Promise.all(
        listed.map(async (session): Promise<SessionSnapshot> => {
          const getAnswer = await atc.read('/session/get', { session: session.id });

          return {
            id: session.id,
            name: session.name,
            state: session.state,
            desired: session.lifecycle.desired,
            harness: session.lifecycle.harness,
            lastActivityAt: SESSION_GET_SCHEMA.parse(getAnswer).lastActivityAt,
          };
        }),
      );
    },
  };
}
