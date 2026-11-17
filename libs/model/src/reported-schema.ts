import { z } from 'zod';

const REPORTED_FAULT_SCHEMA = z.object({
  check: z.string(),

  // the text sent, kept so a resend carries the same text
  line: z.string(),

  // ISO time the fault opened; part of its idempotency keys
  since: z.string(),

  // the send this key still owes stu; null: stu is up to date
  owed: z.enum(['open', 'clear']).nullable(),

  // the idempotency key of the owed send, stored before its first try
  sendKey: z.string().nullable(),

  // true once stu has the open message
  stuKnows: z.boolean(),
});

export type ReportedFault = z.output<typeof REPORTED_FAULT_SCHEMA>;

// What the watcher has told stu, and no more than stops a repeat.
export const REPORTED_SCHEMA = z.object({
  // key: `<check id>:<fault key>`, or the bare check id for its cannot-run fault
  faults: z.record(z.string(), REPORTED_FAULT_SCHEMA),

  // check id → ISO time of its last run
  lastRun: z.record(z.string(), z.string()),
});

export type Reported = z.output<typeof REPORTED_SCHEMA>;
