import { setTimeout as sleep } from 'node:timers/promises';
import { AtcError, connect } from '@atcx/client';
import type { AtcAnswer, AtcProcedures } from '@stu/model';
import type { AtcClient, AtcClientOptions } from './types.ts';

type AtcCall = (procedures: AtcProcedures) => Promise<unknown>;

// One connection per call: connect() finds the daemon and says hello, the call runs, and the
// connection closes. The call and the connect together get `timeoutMs`.
export function createAtcClient(options: AtcClientOptions): AtcClient {
  const run = (call: AtcCall) => runAtcCall(options, call);

  return { read: run, write: run };
}

async function runAtcCall(options: AtcClientOptions, call: AtcCall): Promise<AtcAnswer> {
  const deadline = new AbortController();

  try {
    return await Promise.race([
      connectAndCall(options, call, deadline.signal),
      endCallOnTimeout(options.timeoutMs, deadline.signal),
    ]);
  } finally {
    deadline.abort();
  }
}

async function connectAndCall(
  options: AtcClientOptions,
  call: AtcCall,
  signal: AbortSignal,
): Promise<AtcAnswer> {
  try {
    // the signal closes the connection when the deadline ends the call, or when the call ends
    await using atc = await connect({
      client: options.client,
      timeoutMs: options.timeoutMs,
      signal,
      ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
    });

    const body = await call(atc);

    return { kind: 'answered', body };
  } catch (error) {
    return toFailedAnswer(error);
  }
}

// The codes that say no answer came back, or that the client failed locally, such as on a socket it
// cannot open: none says whether the daemon ran the call, so the caller resends under the same key. Every other code is the daemon's
// refusal.
const UNREACHED_CODES: ReadonlySet<string> = new Set([
  'no_daemon',
  'timeout',
  'connection_lost',
  'internal',
]);

function toFailedAnswer(error: unknown): AtcAnswer {
  if (error instanceof AtcError && !UNREACHED_CODES.has(error.code)) {
    return { kind: 'refused', code: error.code, data: error.data };
  }

  return { kind: 'unreached', reason: error instanceof Error ? error.message : String(error) };
}

// Waits out the deadline, then answers unreached: a daemon that never answers still ends the call.
async function endCallOnTimeout(timeoutMs: number, signal: AbortSignal): Promise<AtcAnswer> {
  try {
    await sleep(timeoutMs, undefined, { signal });
  } catch {
    // the call ended first, and its answer wins the race
    return new Promise<never>(() => {});
  }

  return { kind: 'unreached', reason: `atc gave no answer in ${timeoutMs} ms` };
}
