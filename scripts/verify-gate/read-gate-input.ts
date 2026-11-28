import { z } from 'zod';

const PULL_REQUEST_SCHEMA = z.object({
  body: z.string().nullable(),
  base: z.object({ ref: z.string().min(1) }),
});

const PULL_REQUEST_EVENT_SCHEMA = z.object({ pull_request: PULL_REQUEST_SCHEMA });

export type GateInput =
  | { readonly kind: 'gate'; readonly baseRef: string; readonly body: string }
  | { readonly kind: 'refused'; readonly message: string };

// The body comes from the event, as GitHub held it when the run started, so an `edited` run reads
// the report `bun verify publish` just wrote.
export function readGateInput(event: unknown): GateInput {
  const parsed = PULL_REQUEST_EVENT_SCHEMA.safeParse(event);

  if (!parsed.success) {
    return {
      kind: 'refused',
      message: 'the event holds no pull request; run this on pull_request',
    };
  }

  const pullRequest = parsed.data.pull_request;

  return { kind: 'gate', baseRef: pullRequest.base.ref, body: pullRequest.body ?? '' };
}
