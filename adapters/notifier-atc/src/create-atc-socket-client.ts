import { once } from 'node:events';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { AtcError } from './atc-error.ts';
import { PEER_FIELDS as PEER } from './peer-fields.ts';
import type { AtcSocketClient, AtcSocketOptions } from './types.ts';

// atc's protocol version, which its published contract does not export. A daemon on another
// version refuses the hello with its own version, and the client retries once with that.
const ATC_PROTOCOL = 14;

export function createAtcSocketClient(options: AtcSocketOptions): AtcSocketClient {
  let protocol = ATC_PROTOCOL;

  const call = async (path: string, input: Readonly<Record<string, unknown>>) => {
    try {
      return await runAtcCall(options, protocol, path, input);
    } catch (error) {
      const daemonProtocol = findDaemonProtocol(error);

      if (daemonProtocol === null) {
        throw error;
      }

      protocol = daemonProtocol;

      return runAtcCall(options, protocol, path, input);
    }
  };

  return { read: call, write: call };
}

async function runAtcCall(
  options: AtcSocketOptions,
  protocol: number,
  path: string,
  input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const socket = await createAtcConnection(options);

  try {
    const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
    const hello = { client: options.client, protocol, auth: { scheme: 'none' } };

    socket.write(formatPeerLine('1', '/daemon/hello', hello));

    await readPeerAnswer(lines, '1');

    socket.write(formatPeerLine('2', path, input));

    return await readPeerAnswer(lines, '2');
  } finally {
    socket.destroy();
  }
}

// A path where no daemon listens fails at connect, before any request is written, so the next
// path cannot run a request twice.
async function createAtcConnection(options: AtcSocketOptions): Promise<Socket> {
  const failures: string[] = [];

  for (const path of options.socketPaths) {
    const socket = createConnection({ path });

    socket.setTimeout(options.timeoutMs, () => {
      socket.destroy(new Error(`atc gave no answer in ${options.timeoutMs} ms`));
    });

    try {
      await once(socket, 'connect');

      return socket;
    } catch (error) {
      socket.destroy();

      if (!isNoListener(error)) {
        throw error;
      }

      failures.push(path);
    }
  }

  throw new Error(`no atc daemon listens at ${failures.join(' or ')}`);
}

const NO_LISTENER_SCHEMA = z.object({ code: z.enum(['ENOENT', 'ECONNREFUSED']) });

function isNoListener(error: unknown): boolean {
  return NO_LISTENER_SCHEMA.safeParse(error).success;
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
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

async function readPeerAnswer(lines: AsyncIterator<string>, id: string): Promise<unknown> {
  for (let line = await lines.next(); line.done !== true; line = await lines.next()) {
    const message: unknown = JSON.parse(line.value);
    const answer = PEER_ANSWER_SCHEMA.parse(message);

    if (answer[PEER.id] === id) {
      const payload = answer[PEER.payload];
      const status = payload[PEER.status] ?? 200;
      const body = payload[PEER.body]?.json;

      if (status >= 200 && status < 300) {
        return body;
      }

      const refusal = PEER_ERROR_SCHEMA.parse(body);

      throw new AtcError(refusal.code, refusal.message, refusal.data);
    }
  }

  throw new Error('atc closed the connection before it answered');
}

function findDaemonProtocol(error: unknown): number | null {
  if (!(error instanceof AtcError) || error.code !== 'protocol_mismatch') {
    return null;
  }

  const daemonProtocol = error.data['daemonProtocol'];

  return typeof daemonProtocol === 'number' ? daemonProtocol : null;
}
