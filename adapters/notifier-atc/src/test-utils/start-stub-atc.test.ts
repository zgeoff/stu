import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcSocketClient } from '../create-atc-socket-client.ts';
import { startStubAtc } from './start-stub-atc.ts';
import type { StubAtcRules } from './start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    startAtc: async (rules: StubAtcRules) => {
      const atc = await startStubAtc(folder, rules);

      onTestFinished(() => atc.stop());

      return {
        atc,
        client: createAtcSocketClient({
          socketPaths: [atc.socketPath],
          client: 'stu-watch/0.1.0',
          timeoutMs: 1000,
        }),
      };
    },
  };
}

test('it records the hello that comes before each call', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.read((procedures) => procedures.message.get({ message: 'm-1' }));

  expect(stub.atc.hellos).toStrictEqual([{ client: 'stu-watch/0.1.0', protocol: 14 }]);
});

test('it refuses a hello on another protocol with the daemon version, which the retry gives', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 15,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.read((procedures) => procedures.message.get({ message: 'm-1' }));

  expect(stub.atc.hellos).toStrictEqual([
    { client: 'stu-watch/0.1.0', protocol: 14 },
    { client: 'stu-watch/0.1.0', protocol: 15 },
  ]);
});

test('it answers a resend of a key it holds with the first send message', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  const replay = await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(replay).toStrictEqual({ kind: 'answered', body: { message: 'm-1', status: 'queued' } });
});

test('it stores a message once when its key is sent twice', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

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
    sessions: [],
  });

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  const conflict = await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's2',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(conflict).toStrictEqual({ kind: 'refused', code: 'idempotency_conflict', data: {} });
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
    sessions: [],
  });

  const miss = await stub.client.read((procedures) => procedures.message.get({ message: 'm-9' }));

  expect(miss).toStrictEqual({ kind: 'refused', code: 'bad_args', data: {} });
});

test('it closes the connection without an answer to a send whose reply it drops', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const answer = await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(answer).toStrictEqual({
    kind: 'unreached',
    reason: 'atc closed the connection before it answered',
  });
});

test('it stores a message whose reply it drops', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's1',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(stub.atc.stored).toStrictEqual([
    { id: 'm-1', session: 's1', text: 'hi', from: 'stu-watch', idempotencyKey: 'k1' },
  ]);
});

test('it refuses a key with the code its rules give', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: { 0: 'unknown_session' },
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const refusal = await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'FAULT a',
      from: 'stu-watch',
      idempotencyKey: 'k-1',
    }),
  );

  expect(refusal).toStrictEqual({ kind: 'refused', code: 'unknown_session', data: {} });
});

test('it stores nothing for a key it refuses', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: { 0: 'unknown_session' },
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'FAULT a',
      from: 'stu-watch',
      idempotencyKey: 'k-1',
    }),
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
    sessions: [],
  });

  const refusal = await stub.client.read((procedures) =>
    procedures.message.get({ message: 'm-1' }),
  );

  expect(refusal).toStrictEqual({ kind: 'refused', code: 'internal_error', data: {} });
});

test('it answers each send it takes with the body its rules give', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: { accepted: true },
    sessions: [],
  });

  const answer = await stub.client.write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'FAULT a',
      from: 'stu-watch',
      idempotencyKey: 'k-1',
    }),
  );

  expect(answer).toStrictEqual({ kind: 'answered', body: { accepted: true } });
});

test('it answers /session/list with the descriptor of each session its rules hold', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [{ descriptor: { id: 's1-k9q1r', name: 'build-lane' }, lastActivityAt: 5 }],
  });

  const answer = await stub.client.read((procedures) => procedures.session.list({}));

  expect(answer).toStrictEqual({
    kind: 'answered',
    body: { sessions: [{ id: 's1-k9q1r', name: 'build-lane' }] },
  });
});

test('it answers /session/get with the session and its last activity', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [{ descriptor: { id: 's1-k9q1r', name: 'build-lane' }, lastActivityAt: 5 }],
  });

  const answer = await stub.client.read((procedures) =>
    procedures.session.get({ session: 's1-k9q1r' }),
  );

  expect(answer).toStrictEqual({
    kind: 'answered',
    body: {
      session: { id: 's1-k9q1r', name: 'build-lane' },
      prompt: null,
      lastActivityAt: 5,
      pending: null,
      result: null,
      sessionRecord: null,
    },
  });
});

test('it answers bad_args for a session it does not hold', async () => {
  const ctx = await setupTest();

  const stub = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const answer = await stub.client.read((procedures) => procedures.session.get({ session: 's9' }));

  expect(answer).toStrictEqual({ kind: 'refused', code: 'bad_args', data: {} });
});
