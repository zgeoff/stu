import type { FetchHTTP, Kind } from '@stu/model';
import { z } from 'zod';
import { buildSlotFault } from './build-slot-fault.ts';
import { parseUsageHeaders } from './parse-usage-headers.ts';
import type { SlotUsage } from './parse-usage-headers.ts';

export interface QuotaAnthropicPorts {
  readonly fetch: FetchHTTP;
}

const SLOT = z.strictObject({
  id: z.string().min(1),

  // the slot's OAuth token
  token: z.string().min(1),
});

const QUOTA_PARAMS = z.strictObject({
  // a slot at or over this percent of its 7-day limit is a fault
  sevenPct: z.number().gt(0).lte(100),
  slots: z.array(SLOT).min(1),
});

// A slot that cannot be read throws for the whole check, so the engine reports no slot recovered
// while it cannot look.
export function makeQuotaAnthropicKind(ports: QuotaAnthropicPorts): Kind {
  return async (params) => {
    const quota = QUOTA_PARAMS.parse(params);

    const faults = await Promise.all(
      quota.slots.map(async (slot) => {
        const usage = await readSlotUsage(ports, slot);

        return buildSlotFault(slot.id, usage, quota.sevenPct);
      }),
    );

    return faults.filter((fault) => fault !== null);
  };
}

type Slot = z.output<typeof SLOT>;

const MESSAGES_URL = new URL('https://api.anthropic.com/v1/messages');

// One 1-token request: the messages API answers with the account's rate-limit headers, a 429 at
// the limit included.
async function readSlotUsage(ports: QuotaAnthropicPorts, slot: Slot): Promise<SlotUsage> {
  const response = await ports
    .fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${slot.token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // the subscription route answers claude-haiku-5-5 with a 429 that has no usage headers
        model: 'claude-haiku-4-5',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    .catch((error: unknown) => {
      throw new Error(
        `slot ${slot.id}: the messages API gave no answer (${error instanceof Error ? error.name : 'unknown error'})`,
      );
    });

  await response.body?.cancel();

  const usage = parseUsageHeaders(response.headers);

  if (usage === null) {
    throw new Error(
      `slot ${slot.id}: the messages API answered ${response.status} with no usage headers`,
    );
  }

  return usage;
}
