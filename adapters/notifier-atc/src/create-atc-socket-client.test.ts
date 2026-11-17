import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcSocketClient } from './create-atc-socket-client.ts';
import { startStubAtc } from './test-utils/start-stub-atc.ts';
import type { StubAtcRules } from './test-utils/start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    startAtc: async (rules: StubAtcRules) => {
      const atc = await startStubAtc(folder, rules);

      onTestFinished(() => atc.stop());

      return atc;
    },
    createClient: (socketPath: string) =>
      createAtcSocketClient({ socketPath, client: 'stu-watch/0.1.0', timeoutMs: 200 }),
  };
}

test('it says hello with its client name and protocol 14 before the call', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
  });

  await ctx.createClient(atc.socketPath).write('/session/message', {
    session: 's-stu',
    text: 'hi',
    from: 'stu-watch',
    idempotencyKey: 'k1',
  });

  expect(atc.hellos).toStrictEqual([
    { client: 'stu-watch/0.1.0', protocol: 14, auth: { scheme: 'none' } },
  ]);
});

test('it retries once with the daemon protocol that a protocol_mismatch refusal gives', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 15,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
  });

  await ctx.createClient(atc.socketPath).write('/session/message', {
    session: 's-stu',
    text: 'hi',
    from: 'stu-watch',
    idempotencyKey: 'k1',
  });

  expect([atc.hellos.map((hello) => hello['protocol']), atc.stored.length]).toStrictEqual([
    [14, 15],
    1,
  ]);
});

test('it rejects with the atc code of a refusal', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
  });

  const read = ctx.createClient(atc.socketPath).read('/message/get', { message: 'm-9' });

  expect(read).rejects.toMatchObject({ code: 'bad_args' });
});

test('it rejects when atc closes the connection before it answers', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
  });

  const write = ctx.createClient(atc.socketPath).write('/session/message', {
    session: 's-stu',
    text: 'hi',
    from: 'stu-watch',
    idempotencyKey: 'k1',
  });

  expect(write).rejects.toThrow('closed the connection before it answered');
});

test('it rejects when atc gives no answer within the timeout', async () => {
  const ctx = await setupTest();

  const silent = createServer(() => {});
  const socketPath = join(ctx.folder, 'silent.sock');

  silent.listen(socketPath);

  onTestFinished(() => silent.close());

  const read = ctx.createClient(socketPath).read('/session/list', {});

  expect(read).rejects.toThrow('atc gave no answer in 200 ms');
});

test('it rejects when nothing listens at the socket path', async () => {
  const ctx = await setupTest();

  const read = ctx.createClient(join(ctx.folder, 'atc.sock')).read('/session/list', {});

  expect(read).rejects.toThrow();
});
