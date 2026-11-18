import { z } from 'zod';

// The paths, ids and port of one run, which the launcher prints on its ready line. Each value is a
// string, because wringer keeps a run's endpoints as a record of strings.
const RUN_ENDPOINTS_SCHEMA = z.object({
  root: z.string().min(1),
  home: z.string().min(1),
  runtime: z.string().min(1),
  socket: z.string().min(1),

  // the atc id of the inbox session, which every message of the journey goes to
  session: z.string().min(1),

  // a loopback port that nothing listened on at `up`
  probePort: z.string().regex(/^\d+$/u),
});

export type RunEndpoints = z.output<typeof RUN_ENDPOINTS_SCHEMA>;

export function parseRunEndpoints(value: unknown): RunEndpoints {
  return RUN_ENDPOINTS_SCHEMA.parse(value);
}
