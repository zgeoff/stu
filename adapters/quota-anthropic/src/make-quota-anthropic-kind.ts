import type { Fault, FetchHTTP, Kind, RunProgram } from '@stu/model';
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

  // a slot at or over this percent of a window's limit is a fault
  fivePct: z.number().gt(0).lte(100),
  sevenPct: z.number().gt(0).lte(100),
  slots: z.array(SLOT).min(1),
});

// A slot that cannot be read throws for the whole check, so the engine reports no slot recovered
// while it cannot look, and a 1Password outage opens one fault, not one per slot.
export function makeQuotaAnthropicKind(ports: QuotaAnthropicPorts): Kind {
  return async (params) => {
    const quota = QUOTA_PARAMS.parse(params);
    const faults: Fault[] = [];

    for (const slot of quota.slots) {
      const token = await readSlotToken(ports, quota, slot);
      const usage = await readSlotUsage(ports, slot, token);

      const fault = buildSlotFault(slot.id, usage, quota);

      if (fault !== null) {
        faults.push(fault);
      }
    }

    return faults;
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
    timeoutMs: 30_000,
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
        model: 'claude-haiku-5-5',
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
