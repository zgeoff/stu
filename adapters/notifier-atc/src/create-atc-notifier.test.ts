import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatch } from '@stu/faults';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import type { CheckConfig, KindTable, Notifier, Reported } from '@stu/model';
import { createAtcClient } from './create-atc-client.ts';
import { createAtcNotifier } from './create-atc-notifier.ts';
import { startStubAtc } from './test-utils/start-stub-atc.ts';
import type { StubAtcRules } from './test-utils/start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const empty: Reported = { faults: {}, lastRun: {} };
  const file = { state: empty };

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    startAtc: async (rules: StubAtcRules) => {
      const atc = await startStubAtc(folder, rules);

      onTestFinished(() => atc.stop());

      return atc;
    },
    createNotifier: (socketPath: string, session: string) =>
      createAtcNotifier({
        client: createAtcClient({
          socketPath,
          client: 'stu-watch/0.1.0',
          timeoutMs: 1000,
        }),
        session,
        from: 'stu-watch',
      }),

    runAt: (at: string, checks: readonly CheckConfig[], kinds: KindTable, notifier: Notifier) =>
      runWatch({
        checks,
        kinds,
        state: file.state,
        at: Temporal.Instant.from(at),
        notifier,
        writeReported: (next) => {
          file.state = next;

          return Promise.resolve();
        },
      }),
  };
}

test('it sends as a local program: a hello name outside atc/, and a message with from and its key', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'sent' });

  expect(atc.hellos).toStrictEqual([
    { client: 'stu-watch/0.1.0', protocol: 15, major: 7, auth: { scheme: 'none' } },
  ]);

  expect(atc.requests).toStrictEqual([
    {
      path: '/session/message',
      input: {
        session: 's-stu',
        text: 'FAULT tunnel:a:22: no answer from a:22',
        from: 'stu-watch',
        idempotencyKey: 'stu-watch:0f3a',
      },
    },
  ]);
});

test('it answers sent when atc takes the send and answers in a body of another shape', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: { accepted: true },
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'sent' });
});

test('it settles outcome_unknown as sent through /message/get when atc holds the message', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [0],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'sent' });
  expect(atc.requests.at(-1)).toStrictEqual({ path: '/message/get', input: { message: 'm-1' } });
});

test('it answers rekey for outcome_unknown when atc holds no message under the effectRef', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [0],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({
    kind: 'rekey',
    reason: 'outcome_unknown, and atc holds no m-lost-0',
  });
});

test('it answers rekey for idempotency_conflict', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const message = {
    text: 'FAULT tunnel:a:22: no answer from a:22',
    idempotencyKey: 'stu-watch:0f3a',
  };

  await ctx.createNotifier(atc.socketPath, 's-old').send(message);

  const outcome = await ctx.createNotifier(atc.socketPath, 's-new').send(message);

  expect(outcome).toStrictEqual({
    kind: 'rekey',
    reason: 'idempotency_conflict on stu-watch:0f3a',
  });
});

test('it answers failed with the cause when atc cannot be reached', async () => {
  const ctx = await setupTest();

  const socketPath = join(ctx.folder, 'atc-daemon.sock');

  const outcome = await ctx
    .createNotifier(socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({
    kind: 'failed',
    reason: `atc send failed: no atc daemon answers at ${socketPath}`,
  });
});

test('it answers rekey for outcome_unknown without an effectRef', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: { 0: 'outcome_unknown' },
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'rekey', reason: 'outcome_unknown without an effectRef' });
});

test('it answers failed for outcome_unknown when the message read fails for another cause', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [0],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: 'unauthorized',
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({
    kind: 'failed',
    reason: 'outcome_unknown, and the message read failed',
  });
});

test('it answers failed with the code of any other atc refusal', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: { 0: 'no_such_session' },
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const outcome = await ctx
    .createNotifier(atc.socketPath, 's-stu')
    .send({ text: 'FAULT tunnel:a:22: no answer from a:22', idempotencyKey: 'stu-watch:0f3a' });

  expect(outcome).toStrictEqual({ kind: 'failed', reason: 'no_such_session' });
});

test('it resends a recovery whose reply was lost under its first key, then sends the fault that came back', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [1],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const notifier = ctx.createNotifier(atc.socketPath, 's-stu');
  const fault = { key: 'a:22', line: 'no answer from a:22' };
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[fault], [], [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:02:00Z', checks, kinds, notifier);

  const [open, recovery, recoveryResend, reopen] = atc.requests.map(
    (request) => request.input['idempotencyKey'],
  );

  expect(atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
    'RECOVERED tunnel:a:22 (failing since 2026-11-17T08:00:00.000Z): no answer from a:22',
    'FAULT tunnel:a:22: no answer from a:22',
  ]);

  expect(recoveryResend).toBe(recovery);
  expect(reopen).not.toBeOneOf([open, recovery]);
});

test('it leaves stu one fault message and one recovery when the open reply was lost and the fault cleared', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const notifier = ctx.createNotifier(atc.socketPath, 's-stu');
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }], []]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);

  expect(atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
    'RECOVERED tunnel:a:22 (failing since 2026-11-17T08:00:00.000Z): no answer from a:22',
  ]);
});

test('it stores one message when the first key stays outcome_unknown and the reply to the new key is lost once', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [0],
    unknownStored: [],
    dropFirstReply: [1],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const notifier = ctx.createNotifier(atc.socketPath, 's-stu');
  const fault = { key: 'a:22', line: 'no answer from a:22' };
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[fault], [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);

  const keys = atc.requests
    .filter((request) => request.path === '/session/message')
    .map((request) => request.input['idempotencyKey']);

  const [first] = keys;

  expect(atc.stored).toHaveLength(1);
  expect(keys).toStrictEqual([first, `${String(first)}:2`, `${String(first)}:2`]);
});

test('it sends stu one message under a new key when atc.session changed after a lost reply', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    major: 7,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  const fault = { key: 'a:22', line: 'no answer from a:22' };
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[fault], [fault]]) };

  await ctx.runAt(
    '2026-11-17T08:00:00Z',
    checks,
    kinds,
    ctx.createNotifier(atc.socketPath, 's-old'),
  );

  await ctx.runAt(
    '2026-11-17T08:01:00Z',
    checks,
    kinds,
    ctx.createNotifier(atc.socketPath, 's-new'),
  );

  expect(atc.stored.filter((message) => message.session === 's-new')).toStrictEqual([
    {
      id: 'm-2',
      session: 's-new',
      text: 'FAULT tunnel:a:22: no answer from a:22',
      from: 'stu-watch',
      idempotencyKey: expect.stringMatching(/:2$/u),
    },
  ]);
});
