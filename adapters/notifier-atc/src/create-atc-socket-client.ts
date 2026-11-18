import { once } from 'node:events';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';
import { createInterface } from 'node:readline';
import { ORPCError, createORPCClient } from '@orpc/client';
import { StandardRPCLink } from '@orpc/client/standard';
import { ClientPeer } from '@orpc/standard-server-peer';
import type { AtcAnswer, AtcInputs, AtcProcedures } from '@stu/model';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type { AtcCallPath, AtcSocketClient, AtcSocketOptions } from './types.ts';

// atc's protocol version, which its published contract does not export. A daemon on another
// version refuses the hello with its own version, and the client retries once with that.
const ATC_PROTOCOL = 14;

export function createAtcSocketClient(options: AtcSocketOptions): AtcSocketClient {
  let protocol = ATC_PROTOCOL;

  const call = async <Path extends AtcCallPath>(path: Path, input: AtcInputs[Path]) => {
    const answer = await runAtcCall(options, protocol, path, input);

    const daemonProtocol = findDaemonProtocol(answer);

    if (daemonProtocol === null) {
      return answer;
    }

    protocol = daemonProtocol;

    return runAtcCall(options, protocol, path, input);
  };

  return { read: call, write: call };
}

async function runAtcCall<Path extends AtcCallPath>(
  options: AtcSocketOptions,
  protocol: number,
  path: Path,
  input: AtcInputs[Path],
): Promise<AtcAnswer> {
  const connected = await createAtcConnection(options);

  return match(connected)
    .with({ kind: 'unreached' }, (unreached) => unreached)
    .with({ kind: 'connected' }, async (connection) => {
      const procedures = createAtcProcedures(connection.socket);

      // A socket error, such as atc closing the connection before it reads the hello, rejects the
      // timeout's wait, and it may come after the request reached atc, so it answers unreached.
      try {
        return await Promise.race([
          writeAtcCall(procedures, { client: options.client, protocol }, path, input),
          endCallOnTimeout(connection.socket, options.timeoutMs),
        ]);
      } catch (error) {
        return { kind: 'unreached' as const, reason: formatCause(error) };
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
        endCallOnTimeout(socket, options.timeoutMs),
      ]);
    } catch (error) {
      socket.destroy();

      if (!isNoListener(error)) {
        return {
          kind: 'unreached',
          reason: `atc connect failed at ${path}: ${formatCause(error)}`,
        };
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

// Waits for the socket's idle timer, armed before the connect, then destroys the socket and answers
// unreached, so a daemon that never accepts and one that never answers both end the call.
async function endCallOnTimeout(
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

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// atc's contract over oRPC's peer messages, one JSON message per line, as atc's own clients call it.
// A line the peer cannot read, or a socket error, ends the connection, and a call still waiting then
// fails.
function createAtcProcedures(socket: Socket): AtcProcedures {
  const peer = new ClientPeer((message) => {
    invariant(typeof message === 'string', 'the oRPC peer encodes each message as JSON text');

    socket.write(`${message}\n`);
  });

  createInterface({ input: socket })
    .on('line', (line) => {
      void readPeerLine(peer, socket, line);
    })
    .on('error', () => {
      socket.destroy();
    });

  socket.on('close', () => {
    peer.close({ reason: new Error('atc closed the connection before it answered') });
  });

  const link = new StandardRPCLink(
    {
      call: async (request) => {
        const response = await peer.request(request);

        return { ...response, body: () => Promise.resolve(response.body) };
      },
    },
    { url: 'http://atc' },
  );

  return createORPCClient<AtcProcedures>(link);
}

async function readPeerLine(peer: ClientPeer, socket: Socket, line: string): Promise<void> {
  try {
    await peer.message(line);
  } catch {
    socket.destroy();
  }
}

interface AtcHello {
  readonly client: string;
  readonly protocol: number;
}

type AtcCalls = {
  readonly [Path in AtcCallPath]: (
    procedures: AtcProcedures,
    input: AtcInputs[Path],
  ) => Promise<unknown>;
};

const ATC_CALLS: AtcCalls = {
  '/session/list': (procedures, input) => procedures.session.list(input),
  '/session/get': (procedures, input) => procedures.session.get(input),
  '/message/get': (procedures, input) => procedures.message.get(input),
  '/session/message': (procedures, input) => procedures.session.message(input),
};

// A reset socket or a line the peer cannot read may come after the request reached atc, so it
// answers unreached, and the caller resends under the same key.
async function writeAtcCall<Path extends AtcCallPath>(
  procedures: AtcProcedures,
  hello: AtcHello,
  path: Path,
  input: AtcInputs[Path],
): Promise<AtcAnswer> {
  try {
    await procedures.daemon.hello(hello);

    const body = await ATC_CALLS[path](procedures, input);

    return { kind: 'answered', body };
  } catch (error) {
    return error instanceof ORPCError
      ? toRefusedAnswer(error)
      : { kind: 'unreached', reason: formatCause(error) };
  }
}

const ERROR_DATA_SCHEMA = z.record(z.string(), z.unknown());

// An oRPC error carries the code atc refused with, and the data that code defines.
const REFUSAL_SCHEMA = z.object({ code: z.string(), data: z.unknown() });

function toRefusedAnswer(error: unknown): AtcAnswer {
  const refusal = REFUSAL_SCHEMA.parse(error);
  const data = ERROR_DATA_SCHEMA.safeParse(refusal.data);

  return { kind: 'refused', code: refusal.code, data: data.success ? data.data : {} };
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
