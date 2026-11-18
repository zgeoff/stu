import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcSocketClient } from './create-atc-socket-client.ts';
import { makeAtcNotifier } from './make-atc-notifier.ts';
import { startStubAtc } from './test-utils/start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
    sessions: [],
  });

  onTestFinished(() => atc.stop());

  return {
    atc,
    makeNotifier: makeAtcNotifier({
      client: createAtcSocketClient({
        socketPaths: [atc.socketPath],
        client: 'stu-watch/0.1.0',
        timeoutMs: 1000,
      }),
      from: 'stu-watch',
    }),
  };
}

test('it sends to the session its params name, as from', async () => {
  const ctx = await setupTest();

  const notifier = ctx.makeNotifier({ session: 's-stu' });

  await notifier.send({ text: 'FAULT tunnel: cannot run', idempotencyKey: 'stu-watch:test-1' });

  expect(ctx.atc.stored).toStrictEqual([
    {
      id: 'm-1',
      session: 's-stu',
      text: 'FAULT tunnel: cannot run',
      from: 'stu-watch',
      idempotencyKey: 'stu-watch:test-1',
    },
  ]);
});

test.each([
  ['no session', {}],
  ['an empty session', { session: '' }],
  ['a param it does not know', { session: 's-stu', channel: 'ops' }],
])('it throws for params with %s', async (_case, params) => {
  const ctx = await setupTest();

  expect(() => ctx.makeNotifier(params)).toThrow();
});
