import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { PEER_FIELDS as PEER } from '../peer-fields.ts';

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

const REQUEST_BODY_SCHEMA = z.object({ json: z.record(z.string(), z.unknown()) });

const REQUEST_PAYLOAD_SCHEMA = z.object({
  [PEER.path]: z.string(),
  [PEER.body]: REQUEST_BODY_SCHEMA,
});

const REQUEST_SCHEMA = z.object({ [PEER.id]: z.string(), [PEER.payload]: REQUEST_PAYLOAD_SCHEMA });

const MESSAGE_INPUT_SCHEMA = z.object({
  session: z.string(),
  text: z.string(),
  from: z.string(),
  idempotencyKey: z.string(),
});

// A fake atc daemon on a unix socket in the folder. It records each hello and request, stores each
// message, and replays a key it holds, as atc does.
export async function startStubAtc(folder: string, rules: StubAtcRules) {
  const hellos: Readonly<Record<string, unknown>>[] = [];
  const requests: StubAtcRequest[] = [];
  const stored: StoredMessage[] = [];
  const keys: string[] = [];

  const dropped = new Set<string>();

  const answerMessage = (socket: Socket, id: string, input: Readonly<Record<string, unknown>>) => {
    const message = MESSAGE_INPUT_SCHEMA.parse(input);

    if (!keys.includes(message.idempotencyKey)) {
      keys.push(message.idempotencyKey);
    }

    const order = keys.indexOf(message.idempotencyKey);
    const held = stored.find((entry) => entry.idempotencyKey === message.idempotencyKey);

    if (rules.unknownLost.includes(order)) {
      writeRefusal(socket, id, 'outcome_unknown', { effectRef: `m-lost-${order}` });

      return;
    }

    if (held !== undefined && held.session !== message.session) {
      writeRefusal(socket, id, 'idempotency_conflict', {});

      return;
    }

    const entry = held ?? { id: `m-${stored.length + 1}`, ...message };

    if (held === undefined) {
      stored.push(entry);
    }

    if (rules.unknownStored.includes(order)) {
      writeRefusal(socket, id, 'outcome_unknown', { effectRef: entry.id });

      return;
    }

    if (rules.dropFirstReply.includes(order) && !dropped.has(message.idempotencyKey)) {
      dropped.add(message.idempotencyKey);
      socket.destroy();

      return;
    }

    writeAnswer(socket, id, { message: entry.id, status: 'queued' });
  };

  const answerLine = (socket: Socket, line: string) => {
    const parsed: unknown = JSON.parse(line);
    const request = REQUEST_SCHEMA.parse(parsed);
    const id = request[PEER.id];
    const path = request[PEER.payload][PEER.path];
    const input = request[PEER.payload][PEER.body].json;

    if (path === '/daemon/hello') {
      hellos.push(input);

      if (input['protocol'] === rules.protocol) {
        writeAnswer(socket, id, { peerSession: null });
      } else {
        writeRefusal(socket, id, 'protocol_mismatch', {
          daemonProtocol: rules.protocol,
          clientProtocol: input['protocol'],
        });

        socket.end();
      }

      return;
    }

    requests.push({ path, input });

    if (path === '/session/message') {
      answerMessage(socket, id, input);
    } else if (path === '/message/get') {
      const found = stored.find((entry) => entry.id === input['message']);

      if (found === undefined) {
        writeRefusal(socket, id, 'bad_args', {});
      } else {
        writeAnswer(socket, id, { id: found.id, session: found.session, text: found.text });
      }
    } else {
      writeRefusal(socket, id, 'unknown_method', {});
    }
  };

  const connections = new Set<Socket>();

  const server = createServer((socket) => {
    connections.add(socket);

    socket.on('close', () => {
      connections.delete(socket);
    });

    createInterface({ input: socket }).on('line', (line) => {
      answerLine(socket, line);
    });
  });

  const socketPath = join(folder, 'atc.sock');

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

// The body an oRPC error carries: its code, message and the data the code defines.
function writeRefusal(
  socket: Socket,
  id: string,
  code: string,
  data: Readonly<Record<string, unknown>>,
): void {
  const json = { defined: false, code, status: 400, message: `stub atc: ${code}`, data };
  const refusal = { [PEER.id]: id, [PEER.payload]: { [PEER.status]: 400, [PEER.body]: { json } } };

  socket.write(`${JSON.stringify(refusal)}\n`);
}

function writeAnswer(socket: Socket, id: string, json: unknown): void {
  const answer = { [PEER.id]: id, [PEER.payload]: { [PEER.body]: { json } } };

  socket.write(`${JSON.stringify(answer)}\n`);
}
