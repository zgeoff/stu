import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { startStubAtc } from './start-stub-atc.ts';
import type { StubAtcRules } from './start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    startAtc: async (rules: StubAtcRules) => {
      const atc = await startStubAtc(folder, rules);

      onTestFinished(() => atc.stop());

      const socket = createConnection({ path: atc.socketPath });

      onTestFinished(() => socket.destroy());

      return {
        atc,
        socket,
        lines: createInterface({ input: socket })[Symbol.asyncIterator](),
        write: (line: string) => socket.write(line),
      };
    },
  };
}

// The request lines below are the ones atc's own tests record for its peer client.
test('it answers a hello in the peer framing atc writes', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write(
    '{"i":"1","p":{"u":"/daemon/hello","b":{"json":{"client":"atc/test","protocol":14}}}}\n',
  );

  const answer = await stub.lines.next();

  expect(answer.value).toBe('{"i":"1","p":{"b":{"json":{"peerSession":null}}}}');
});

test('it refuses a hello on another protocol with status 400 and the daemon version in data', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write(
    '{"i":"1","p":{"u":"/daemon/hello","b":{"json":{"client":"atc/test","protocol":9}}}}\n',
  );

  const answer = await stub.lines.next();

  expect(answer.value).toBe(
    '{"i":"1","p":{"s":400,"b":{"json":{"defined":false,"code":"protocol_mismatch","status":400,"message":"stub atc: protocol_mismatch","data":{"daemonProtocol":14,"clientProtocol":9}}}}}',
  );
});

test('it stores a message once and replays its key on a resend', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  const send =
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n';

  stub.write(send);

  await stub.lines.next();

  stub.write(send);

  const replay = await stub.lines.next();

  expect(replay.value).toBe('{"i":"2","p":{"b":{"json":{"message":"m-1","status":"queued"}}}}');

  expect(stub.atc.stored).toStrictEqual([
    { id: 'm-1', session: 's1', text: 'hi', from: 'stu-watch', idempotencyKey: 'k1' },
  ]);
});

test('it answers idempotency_conflict for a held key sent to another session', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write(
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  await stub.lines.next();

  stub.write(
    '{"i":"3","p":{"u":"/session/message","b":{"json":{"session":"s2","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  const conflict = await stub.lines.next();

  expect(conflict.value).toInclude('"code":"idempotency_conflict"');
});

test('it answers bad_args for a message it does not hold', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write('{"i":"4","p":{"u":"/message/get","b":{"json":{"message":"m-9"}}}}\n');

  const miss = await stub.lines.next();

  expect(miss.value).toInclude('{"s":400,"b":{"json":{"defined":false,"code":"bad_args"');
});

test('it stores a message whose reply it drops, and closes the connection without an answer', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write(
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  await once(stub.socket, 'close');

  expect(stub.atc.stored).toHaveLength(1);
});

test('it refuses a key with the code its rules give, and stores nothing', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: { 0: 'unknown_session' },
    messageReadRefusal: null,
    sendAnswer: null,
  });

  stub.write(
    '{"i":"1","p":{"u":"/session/message","b":{"json":{"session":"s-stu","text":"FAULT a","from":"stu-watch","idempotencyKey":"k-1"}}}}\n',
  );

  const refusal = await stub.lines.next();

  expect(refusal.value).toInclude(
    '"code":"unknown_session","status":400,"message":"stub atc: unknown_session","data":{}',
  );

  expect(stub.atc.stored).toStrictEqual([]);
});

test('it answers every message read with the refusal its rules give', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: 'internal_error',
    sendAnswer: null,
  });

  stub.write('{"i":"1","p":{"u":"/message/get","b":{"json":{"message":"m-1"}}}}\n');

  const refusal = await stub.lines.next();

  expect(refusal.value).toInclude('"code":"internal_error"');
});

test('it answers each send it takes with the body its rules give, and stores the message', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: { accepted: true },
  });

  stub.write(
    '{"i":"1","p":{"u":"/session/message","b":{"json":{"session":"s-stu","text":"FAULT a","from":"stu-watch","idempotencyKey":"k-1"}}}}\n',
  );

  const answer = await stub.lines.next();

  expect(answer.value).toBe('{"i":"1","p":{"b":{"json":{"accepted":true}}}}');

  expect(stub.atc.stored).toStrictEqual([
    { id: 'm-1', session: 's-stu', text: 'FAULT a', from: 'stu-watch', idempotencyKey: 'k-1' },
  ]);
});
