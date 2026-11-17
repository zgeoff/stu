import { once } from 'node:events';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { createInterface } from 'node:readline';
import type { AtcAnswer } from '@stu/model';
import { match } from 'ts-pattern';
import { z } from 'zod';
import { PEER_FIELDS as PEER } from './peer-fields.ts';
import type { AtcSocketClient, AtcSocketOptions } from './types.ts';

// atc's protocol version, which its published contract does not export. A daemon on another
// version refuses the hello with its own version, and the client retries once with that.
const ATC_PROTOCOL = 14;

export function createAtcSocketClient(options: AtcSocketOptions): AtcSocketClient {
  let protocol = ATC_PROTOCOL;

  const call = async (path: string, input: Readonly<Record<string, unknown>>) => {
    const answer = await runAtcCall(options, protocol, { path, input });

    const daemonProtocol = findDaemonProtocol(answer);

    if (daemonProtocol === null) {
      return answer;
    }

    protocol = daemonProtocol;

    return runAtcCall(options, protocol, { path, input });
  };

  return { read: call, write: call };
}

interface AtcCall {
  readonly path: string;
  readonly input: Readonly<Record<string, unknown>>;
}

async function runAtcCall(
  options: AtcSocketOptions,
  protocol: number,
  call: AtcCall,
): Promise<AtcAnswer> {
  const connected = await createAtcConnection(options);

  return match(connected)
    .with({ kind: 'unreached' }, (unreached) => unreached)
    .with({ kind: 'connected' }, async (connection) => {
      const hello = { client: options.client, protocol, auth: { scheme: 'none' } };

      try {
        return await Promise.race([
          writeAtcCall(connection.socket, hello, call),
          waitForSilence(connection.socket, options.timeoutMs),
        ]);
      } finally {
        connection.socket.destroy();
      }
    })
    .exhaustive();
}

type AtcConnection =
  | { readonly kind: 'connected'; readonly socket: Socket }
  | { readonly kind: 'unreached'; readonly reason: string };

// A path where no daemon listens fails at connect, before any request is written, so the next
// path cannot run a request twice.
async function createAtcConnection(options: AtcSocketOptions): Promise<AtcConnection> {
  const missed: string[] = [];

  for (const path of options.socketPaths) {
    const socket = createConnection({ path });

    socket.setTimeout(options.timeoutMs);

    try {
      return await Promise.race([
        waitForConnect(socket),
        waitForSilence(socket, options.timeoutMs),
      ]);
    } catch (error) {
      socket.destroy();

      if (!isNoListener(error)) {
        throw error;
      }

      missed.push(path);
    }
  }

  return { kind: 'unreached', reason: `no atc daemon listens at ${missed.join(' or ')}` };
}

async function waitForConnect(socket: Socket): Promise<AtcConnection> {
  await once(socket, 'connect');

  return { kind: 'connected', socket };
}

// The socket's idle timer, armed before the connect, so a daemon that never accepts and one that
// never answers both end the call.
async function waitForSilence(
  socket: Socket,
  timeoutMs: number,
): Promise<{ readonly kind: 'unreached'; readonly reason: string }> {
  await once(socket, 'timeout');

  socket.destroy();

  return { kind: 'unreached', reason: `atc gave no answer in ${timeoutMs} ms` };
}

const NO_LISTENER_SCHEMA = z.object({ code: z.enum(['ENOENT', 'ECONNREFUSED']) });

function isNoListener(error: unknown): boolean {
  return NO_LISTENER_SCHEMA.safeParse(error).success;
}

async function writeAtcCall(socket: Socket, hello: unknown, call: AtcCall): Promise<AtcAnswer> {
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();

  socket.write(formatPeerLine('1', '/daemon/hello', hello));

  const helloAnswer = await readPeerAnswer(lines, '1');

  return match(helloAnswer)
    .with({ kind: 'answered' }, () => {
      socket.write(formatPeerLine('2', call.path, call.input));

      return readPeerAnswer(lines, '2');
    })
    .with({ kind: 'refused' }, { kind: 'unreached' }, (answer) => answer)
    .exhaustive();
}

function formatPeerLine(id: string, path: string, input: unknown): string {
  const request = {
    [PEER.id]: id,
    [PEER.payload]: { [PEER.path]: path, [PEER.body]: { json: input } },
  };

  return `${JSON.stringify(request)}\n`;
}

const PEER_PAYLOAD_SCHEMA = z.object({
  // the HTTP-style status; left out for 200
  [PEER.status]: z.number().optional(),
  [PEER.body]: z.object({ json: z.unknown() }).optional(),
});

const PEER_ANSWER_SCHEMA = z.object({ [PEER.id]: z.string(), [PEER.payload]: PEER_PAYLOAD_SCHEMA });

const PEER_ERROR_SCHEMA = z.object({
  code: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

async function readPeerAnswer(lines: AsyncIterator<string>, id: string): Promise<AtcAnswer> {
  for (let line = await lines.next(); line.done !== true; line = await lines.next()) {
    const message: unknown = JSON.parse(line.value);
    const answer = PEER_ANSWER_SCHEMA.parse(message);

    if (answer[PEER.id] === id) {
      const payload = answer[PEER.payload];
      const status = payload[PEER.status] ?? 200;
      const body = payload[PEER.body]?.json;

      if (status >= 200 && status < 300) {
        return { kind: 'answered', body };
      }

      const refusal = PEER_ERROR_SCHEMA.parse(body);

      return { kind: 'refused', code: refusal.code, data: refusal.data ?? {} };
    }
  }

  return { kind: 'unreached', reason: 'atc closed the connection before it answered' };
}

function findDaemonProtocol(answer: AtcAnswer): number | null {
  return match(answer)
    .with({ kind: 'refused', code: 'protocol_mismatch' }, (refused) => {
      const daemonProtocol = refused.data['daemonProtocol'];

      return typeof daemonProtocol === 'number' ? daemonProtocol : null;
    })
    .with({ kind: 'refused' }, { kind: 'answered' }, { kind: 'unreached' }, () => null)
    .exhaustive();
}
