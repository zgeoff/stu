import { z } from 'zod';

const FAULT_FIELDS = {
  check: z.string(),

  // the text sent, kept so a resend carries the same text
  line: z.string(),

  // ISO time the fault opened; part of its idempotency keys
  since: z.iso.datetime(),

  // true once stu has the open message
  stuKnows: z.boolean(),
};

// owed: the send this key still owes stu, with its idempotency key, stored before its first try.
// null: stu is up to date, and no key is held.
const REPORTED_FAULT_SCHEMA = z.union([
  z.object({ ...FAULT_FIELDS, owed: z.enum(['open', 'clear']), sendKey: z.string().min(1) }),
  z.object({ ...FAULT_FIELDS, owed: z.null(), sendKey: z.null() }),
]);

export type ReportedFault = z.output<typeof REPORTED_FAULT_SCHEMA>;

// What the watcher has told stu, and no more than stops a repeat.
export const REPORTED_SCHEMA = z.object({
  // key: `<check id>:<fault key>`, or the bare check id for its cannot-run fault
  faults: z.record(z.string(), REPORTED_FAULT_SCHEMA),

  // check id → ISO time of its last run
  lastRun: z.record(z.string(), z.iso.datetime()),
});

export type Reported = z.output<typeof REPORTED_SCHEMA>;
