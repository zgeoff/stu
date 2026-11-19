import type { FetchHTTP, Kind, RunProgram } from '@stu/model';
import { z } from 'zod';
import { buildSlotFault } from './build-slot-fault.ts';
import { parseUsageHeaders } from './parse-usage-headers.ts';
import type { SlotUsage } from './parse-usage-headers.ts';

export interface QuotaAnthropicPorts {
  readonly run: RunProgram;
  readonly fetch: FetchHTTP;

  // what op needs of the watcher's environment, such as PATH and HOME
  readonly opEnv: Readonly<Record<string, string>>;
}

const SLOT = z.strictObject({
  id: z.string().min(1),

  // the op:// reference of the slot's token
  tokenRef: z.string().startsWith('op://'),
});

const QUOTA_PARAMS = z.strictObject({
  // the 1Password service account token that op reads the slot tokens with
  opServiceAccountToken: z.string().min(1),

  // a slot at or over this percent of its 7-day limit is a fault
  sevenPct: z.number().gt(0).lte(100),
  slots: z.array(SLOT).min(1),
});

// A slot that cannot be read throws for the whole check, so the engine reports no slot recovered
// while it cannot look, and a 1Password outage opens one fault, not one per slot.
export function makeQuotaAnthropicKind(ports: QuotaAnthropicPorts): Kind {
  return async (params) => {
    const quota = QUOTA_PARAMS.parse(params);

    // Each op read took 6 to 7 s when measured, so four in turn ran past the check's timeout
    const faults = await Promise.all(
      quota.slots.map(async (slot) => {
        const token = await readSlotToken(ports, quota, slot);
        const usage = await readSlotUsage(ports, slot, token);

        return buildSlotFault(slot.id, usage, quota.sevenPct);
      }),
    );

    return faults.filter((fault) => fault !== null);
  };
}

type QuotaTarget = z.output<typeof QUOTA_PARAMS>;

type Slot = z.output<typeof SLOT>;

// No message quotes op's output or the reference, which can name the vault.
async function readSlotToken(
  ports: QuotaAnthropicPorts,
  quota: QuotaTarget,
  slot: Slot,
): Promise<string> {
  const result = await ports.run(['op', 'read', slot.tokenRef], {
    env: { ...ports.opEnv, OP_SERVICE_ACCOUNT_TOKEN: quota.opServiceAccountToken },

    // with the 15 s request, a slot gives up inside the watcher's 30 s check timeout, so a hung op
    // fails naming its slot
    timeoutMs: 10_000,
  });

  const token = result.stdout.trim();

  if (result.code !== 0 || token === '') {
    throw new Error(`slot ${slot.id}: op read failed (exit ${result.code})`);
  }

  return token;
}

const MESSAGES_URL = new URL('https://api.anthropic.com/v1/messages');

// One 1-token request: the messages API answers with the account's rate-limit headers, a 429 at
// the limit included.
async function readSlotUsage(
  ports: QuotaAnthropicPorts,
  slot: Slot,
  token: string,
): Promise<SlotUsage> {
  const response = await ports
    .fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
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
