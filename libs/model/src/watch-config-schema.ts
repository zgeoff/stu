import { z } from 'zod';

// One check instance. Every field beside these three is a param of its kind.
export const CHECK_CONFIG_SCHEMA = z.looseObject({
  // prefixes every fault key the check yields, so it holds no ':'
  id: z.string().regex(/^[a-z0-9-]+$/u, 'a check id holds only a-z, 0-9 and -'),

  // the name of a kind in the watcher's kind table, such as "tcp"
  kind: z.string().min(1),

  // left out: the check runs on every run
  everyMin: z.number().positive().optional(),
});

export type CheckConfig = z.output<typeof CHECK_CONFIG_SCHEMA>;

export const WATCH_CONFIG_SCHEMA = z.object({
  atc: z.object({
    // the atc id of the session that gets every message
    session: z.string().min(1),
  }),

  // the reported file; a relative path is read from the config file's folder
  statePath: z.string().min(1),
  checks: z
    .array(CHECK_CONFIG_SCHEMA)
    .refine((checks) => new Set(checks.map((check) => check.id)).size === checks.length, {
      message: 'each check id must be unique',
    }),
});

export type WatchConfig = z.output<typeof WATCH_CONFIG_SCHEMA>;
