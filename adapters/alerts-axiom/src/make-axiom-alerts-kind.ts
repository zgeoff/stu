import type { Fault, FetchHTTP, Kind, SleepMs } from '@stu/model';
import { z } from 'zod';
import { canMonitorResolve } from './can-monitor-resolve.ts';
import { findFiringSince } from './find-firing-since.ts';

export interface AxiomAlertsPorts {
  readonly fetch: FetchHTTP;
  readonly readNowMs: () => number;
  readonly sleepMs: SleepMs;
}

const AXIOM_PARAMS = z.strictObject({
  // Axiom's API, such as https://api.axiom.co
  apiURL: z.url(),

  // an Axiom token that can read the monitors and their datasets
  token: z.string().min(1),
});

// A type outside this list fails the parse, so the check throws and never drops a monitor unread.
const MONITOR = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(['Threshold', 'MatchEvent', 'AnomalyDetection']),
  disabled: z.boolean().optional(),
  skipResolved: z.boolean().optional(),
});

const MONITORS_ANSWER = z.array(MONITOR);

interface AxiomSource {
  readonly fetch: FetchHTTP;

  // the API's URL without a trailing slash
  readonly base: string;
  readonly token: string;
  readonly sleepMs: SleepMs;

  // aborts at the kind's deadline
  readonly deadline: AbortSignal;
}

// The watcher fails a check at 30 s with a message that names nothing it read. The kind and each
// request give up first, so a hung request fails with a message that names it.
const KIND_DEADLINE_MS = 25_000;

export function makeAxiomAlertsKind(ports: AxiomAlertsPorts): Kind {
  return async (params) => {
    const axiom = AXIOM_PARAMS.parse(params);
    const now = Temporal.Instant.fromEpochMilliseconds(ports.readNowMs());

    const run = new AbortController();

    const source: AxiomSource = {
      fetch: ports.fetch,
      base: axiom.apiURL.replace(/\/$/u, ''),
      token: axiom.token,
      sleepMs: ports.sleepMs,
      deadline: createTimeoutSignal(ports.sleepMs, KIND_DEADLINE_MS, run.signal),
    };

    try {
      const monitors = await readAxiomAnswer(source, {
        url: new URL(`${source.base}/v2/monitors`),
        what: 'monitors',
        schema: MONITORS_ANSWER,
      });

      return await readMonitorFaults(
        source,
        monitors.filter((candidate) => canMonitorResolve(candidate)),
        now,
      );
    } finally {
      run.abort();
    }
  };
}

function createTimeoutSignal(sleepMs: SleepMs, timeoutMs: number, stop: AbortSignal): AbortSignal {
  const timeout = new AbortController();

  void abortAfterSleep(timeout, sleepMs, timeoutMs, stop);

  return timeout.signal;
}

async function abortAfterSleep(
  timeout: AbortController,
  sleepMs: SleepMs,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<void> {
  try {
    await sleepMs(timeoutMs, stop);
  } catch {
    return;
  }

  timeout.abort(new DOMException(`no answer in ${timeoutMs} ms`, 'TimeoutError'));
}

interface AxiomRequest<Answer> {
  readonly url: URL;

  // what the request reads, for a thrown message, such as "monitors"
  readonly what: string;
  readonly schema: z.ZodType<Answer>;
}

const REQUEST_LIMIT_MS = 10_000;

// No thrown message quotes the URL, the token or the body: the engine sends it to stu.
async function readAxiomAnswer<Answer>(
  source: AxiomSource,
  request: AxiomRequest<Answer>,
): Promise<Answer> {
  const requestEnd = new AbortController();

  try {
    const response = await source
      .fetch(request.url, {
        headers: { authorization: `Bearer ${source.token}`, accept: 'application/json' },
        signal: AbortSignal.any([
          source.deadline,
          createTimeoutSignal(source.sleepMs, REQUEST_LIMIT_MS, requestEnd.signal),
        ]),
      })
      .catch((error: unknown) => {
        throw new Error(`axiom gave no answer for ${request.what} (${toErrorName(error)})`);
      });

    if (!response.ok) {
      await response.body?.cancel();

      throw new Error(`axiom answered ${response.status} for ${request.what}`);
    }

    const body: unknown = await response.json().catch(() => null);

    const answer = request.schema.safeParse(body);

    if (!answer.success) {
      throw new Error(`axiom gave an answer the kind cannot read for ${request.what}`);
    }

    return answer.data;
  } finally {
    requestEnd.abort();
  }
}

function toErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

// Two rounds read the 7 monitors a live account had, and a run every 5 minutes stays far under any
// per-minute limit of Axiom's API.
const HISTORY_READS_AT_ONCE = 4;

async function readMonitorFaults(
  source: AxiomSource,
  monitors: readonly z.output<typeof MONITOR>[],
  now: Temporal.Instant,
): Promise<Fault[]> {
  const found: (Fault | null)[] = [];
  const queue = monitors.entries();
  let hasFailed = false;

  const readQueue = async () => {
    for (const [index, monitor] of queue) {
      if (hasFailed) {
        return;
      }

      try {
        found[index] = await readMonitorFault(source, monitor, now);
      } catch (error) {
        hasFailed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: HISTORY_READS_AT_ONCE }, readQueue));

  return found.filter((fault) => fault !== null);
}

const NOTIFICATION = z.looseObject({
  timestamp: z.iso.datetime({ offset: true }),
  state: z.enum(['open', 'closed']),
});

const HISTORY_ANSWER = z.array(NOTIFICATION);

// A monitor still open from before the window would read as resolved, so the window is long.
const HISTORY_WINDOW = Temporal.Duration.from({ hours: 30 * 24 });

async function readMonitorFault(
  source: AxiomSource,
  monitor: z.output<typeof MONITOR>,
  now: Temporal.Instant,
): Promise<Fault | null> {
  const url = new URL(`${source.base}/v2/monitors/${encodeURIComponent(monitor.id)}/history`);

  url.searchParams.set('startTime', now.subtract(HISTORY_WINDOW).toString());
  url.searchParams.set('endTime', now.toString());

  const history = await readAxiomAnswer(source, {
    url,
    what: `history of ${monitor.id}`,
    schema: HISTORY_ANSWER,
  });

  const firingSince = findFiringSince(history);

  return firingSince === null
    ? null
    : {
        key: monitor.id,
        line: `Axiom monitor ${JSON.stringify(monitor.name)} triggered at ${firingSince}`,
      };
}
