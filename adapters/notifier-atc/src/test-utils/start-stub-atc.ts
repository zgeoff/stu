import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ORPCError } from '@orpc/client';
import { StandardRPCJsonSerializer, StandardRPCSerializer } from '@orpc/client/standard';
import type { StandardRequest, StandardResponse } from '@orpc/standard-server';
import { ServerPeer } from '@orpc/standard-server-peer';
import { match } from 'ts-pattern';
import { z } from 'zod';

// How the stub daemon treats each idempotency key, by the order it first sees the key: 0 is the
// first key sent.
export interface StubAtcRules {
  // the protocol version the stub speaks; a hello with another gets protocol_mismatch
  readonly protocol: number;

  // answered outcome_unknown on every send, with no message stored
  readonly unknownLost: readonly number[];

  // stored on the first send, then answered outcome_unknown on every send
  readonly unknownStored: readonly number[];

  // stored on the first send, whose reply the stub drops by closing the connection
  readonly dropFirstReply: readonly number[];

  // answered on every send with the error code given, with no data and no message stored
  readonly refusedKeys: Readonly<Record<number, string>>;

  // the error code every /message/get answers with; null: answer each read from the messages held
  readonly messageReadRefusal: string | null;

  // the body every send that atc takes is answered with; null: the message id and its status
  readonly sendAnswer: Readonly<Record<string, unknown>> | null;
}

export interface StoredMessage {
  readonly id: string;
  readonly session: string;
  readonly text: string;
  readonly from: string;
  readonly idempotencyKey: string;
}

export interface StubAtcRequest {
  readonly path: string;
  readonly input: Readonly<Record<string, unknown>>;
}

// What the stub does with one request: answer it, refuse it, or close the connection without a
// response.
type StubAtcReply =
  | { readonly kind: 'answer'; readonly body: unknown }
  | {
      readonly kind: 'refuse';
      readonly code: string;
      readonly data: Readonly<Record<string, unknown>>;
      readonly thenClose: boolean;
    }
  | { readonly kind: 'drop' };

const MESSAGE_INPUT_SCHEMA = z.object({
  session: z.string(),
  text: z.string(),
  from: z.string(),
  idempotencyKey: z.string(),
});

// A fake atc daemon on a unix socket in the folder, speaking oRPC's peer messages as atc does. It
// records each hello and request, stores each message, and replays a key it holds, as atc does.
export async function startStubAtc(folder: string, rules: StubAtcRules) {
  const hellos: Readonly<Record<string, unknown>>[] = [];
  const requests: StubAtcRequest[] = [];
  const stored: StoredMessage[] = [];
  const keys: string[] = [];

  const dropped = new Set<string>();

  const replyToMessage = (input: Readonly<Record<string, unknown>>): StubAtcReply => {
    const message = MESSAGE_INPUT_SCHEMA.parse(input);

    if (!keys.includes(message.idempotencyKey)) {
      keys.push(message.idempotencyKey);
    }

    const order = keys.indexOf(message.idempotencyKey);
    const held = stored.find((entry) => entry.idempotencyKey === message.idempotencyKey);
    const refusal = rules.refusedKeys[order];

    if (refusal !== undefined) {
      return { kind: 'refuse', code: refusal, data: {}, thenClose: false };
    }

    if (rules.unknownLost.includes(order)) {
      return {
        kind: 'refuse',
        code: 'outcome_unknown',
        data: { effectRef: `m-lost-${order}` },
        thenClose: false,
      };
    }

    if (held !== undefined && held.session !== message.session) {
      return { kind: 'refuse', code: 'idempotency_conflict', data: {}, thenClose: false };
    }

    const entry = held ?? { id: `m-${stored.length + 1}`, ...message };

    if (held === undefined) {
      stored.push(entry);
    }

    if (rules.unknownStored.includes(order)) {
      return {
        kind: 'refuse',
        code: 'outcome_unknown',
        data: { effectRef: entry.id },
        thenClose: false,
      };
    }

    if (rules.dropFirstReply.includes(order) && !dropped.has(message.idempotencyKey)) {
      dropped.add(message.idempotencyKey);

      return { kind: 'drop' };
    }

    return { kind: 'answer', body: rules.sendAnswer ?? { message: entry.id, status: 'queued' } };
  };

  const replyToMessageRead = (input: Readonly<Record<string, unknown>>): StubAtcReply => {
    if (rules.messageReadRefusal !== null) {
      return { kind: 'refuse', code: rules.messageReadRefusal, data: {}, thenClose: false };
    }

    const found = stored.find((entry) => entry.id === input['message']);

    return found === undefined
      ? { kind: 'refuse', code: 'bad_args', data: {}, thenClose: false }
      : { kind: 'answer', body: { id: found.id, session: found.session, text: found.text } };
  };

  const replyToHello = (input: Readonly<Record<string, unknown>>): StubAtcReply => {
    hellos.push(input);

    return input['protocol'] === rules.protocol
      ? { kind: 'answer', body: { peerSession: null } }
      : {
          kind: 'refuse',
          code: 'protocol_mismatch',
          data: { daemonProtocol: rules.protocol, clientProtocol: input['protocol'] },
          thenClose: true,
        };
  };

  const replyByPath: Readonly<
    Record<string, (input: Readonly<Record<string, unknown>>) => StubAtcReply>
  > = {
    '/session/message': replyToMessage,
    '/message/get': replyToMessageRead,
  };

  // a hello is recorded on its own, and every other request in the order it came
  const replyToRequest = (path: string, input: Readonly<Record<string, unknown>>): StubAtcReply => {
    if (path === '/daemon/hello') {
      return replyToHello(input);
    }

    requests.push({ path, input });

    const reply = replyByPath[path];

    return reply === undefined
      ? { kind: 'refuse', code: 'unknown_method', data: {}, thenClose: false }
      : reply(input);
  };

  const connections = new Set<Socket>();

  const server = createServer((socket) => {
    const peer = new ServerPeer((message) => {
      if (!socket.destroyed) {
        socket.write(`${String(message)}\n`);
      }
    });

    connections.add(socket);

    socket.on('close', () => {
      connections.delete(socket);
      peer.close();
    });

    createInterface({ input: socket })
      .on('line', (line) => {
        void peer.message(line, (request) => {
          const reply = replyToRequest(request.url.pathname, readRequestInput(request));

          return buildStubResponse(socket, reply);
        });
      })
      .on('error', () => {
        socket.destroy();
      });
  });

  // the name atc gives its client socket; atc.sock beside it is the socket its session hooks report on
  const socketPath = join(folder, 'atc-daemon.sock');

  server.listen(socketPath);

  await once(server, 'listening');

  return {
    socketPath,
    hellos,
    requests,
    stored,
    stop: async () => {
      for (const socket of connections) {
        socket.destroy();
      }

      server.close();

      await once(server, 'close');
    },
  };
}

const INPUT_SCHEMA = z.record(z.string(), z.unknown());

const SERIALIZER = new StandardRPCSerializer(new StandardRPCJsonSerializer());

function readRequestInput(request: StandardRequest): Readonly<Record<string, unknown>> {
  return INPUT_SCHEMA.parse(SERIALIZER.deserialize(request.body));
}

// A dropped request gets no response: the stub closes the connection, and the response waits for
// good.
function buildStubResponse(socket: Socket, reply: StubAtcReply): Promise<StandardResponse> {
  return match(reply)
    .with({ kind: 'drop' }, () => {
      socket.destroy();

      return Promise.withResolvers<StandardResponse>().promise;
    })
    .with({ kind: 'answer' }, (answer) =>
      Promise.resolve({ status: 200, headers: {}, body: SERIALIZER.serialize(answer.body) }),
    )
    .with({ kind: 'refuse' }, (refusal) => {
      const error = new ORPCError<string, unknown>(refusal.code, {
        status: 400,
        message: `stub atc: ${refusal.code}`,
        data: refusal.data,
      });

      if (refusal.thenClose) {
        setImmediate(() => socket.end());
      }

      return Promise.resolve({
        status: error.status,
        headers: {},
        body: SERIALIZER.serialize(error.toJSON()),
      });
    })
    .exhaustive();
}
