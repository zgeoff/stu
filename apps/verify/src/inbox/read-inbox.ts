import { EVENTS_PAGE_SCHEMA, MESSAGE_VIEW_SCHEMA } from '@atcx/contract';
import { z } from 'zod';
import { openRunAtc } from '../run/open-run-atc.ts';
import { parseAtcBody } from '../run/parse-atc-body.ts';
import type { RunEndpoints } from '../run/run-endpoints-schema.ts';
import { collectMessageIDs } from './collect-message-ids.ts';

export const INBOX_MESSAGE_SCHEMA = z.strictObject({
  from: z.string(),
  sender: z.string(),
  text: z.string(),
});

export type InboxMessage = z.output<typeof INBOX_MESSAGE_SCHEMA>;

// Reads the inbox session's events and each message they name. It reads through events.read and
// message.get, because `atc tap` acks each message, and session.read holds a message only once the
// session's claude takes it, which a claude with no login never does.
export async function readInbox(run: RunEndpoints): Promise<{ messages: InboxMessage[] }> {
  const atc = openRunAtc(run.socket);
  const events: z.output<typeof EVENTS_PAGE_SCHEMA>['events'][number][] = [];

  const firstAnswer = await atc.read((procedures) =>
    procedures.events.read({ session: run.session, from: 'start', waitMs: 0 }),
  );

  let page = parseAtcBody('/events/read', firstAnswer, EVENTS_PAGE_SCHEMA);

  events.push(...page.events);

  while (page.more) {
    const cursor = page.cursor;

    const answer = await atc.read((procedures) =>
      procedures.events.read({ session: run.session, cursor, waitMs: 0 }),
    );

    page = parseAtcBody('/events/read', answer, EVENTS_PAGE_SCHEMA);

    events.push(...page.events);
  }

  const messages: InboxMessage[] = [];

  for (const message of collectMessageIDs(events)) {
    const answer = await atc.read((procedures) => procedures.message.get({ message, waitMs: 0 }));

    const view = parseAtcBody('/message/get', answer, MESSAGE_VIEW_SCHEMA);

    messages.push({ from: view.from, sender: view.sender?.kind ?? 'none', text: view.text });
  }

  return { messages };
}
