import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcClient } from './create-atc-client.ts';
import { startStubAtc } from './test-utils/start-stub-atc.ts';
import type { StubAtcRules } from './test-utils/start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    startAtc: async (overrides: Partial<StubAtcRules> = {}) => {
      const atc = await startStubAtc(folder, {
        major: 8,
        unknownLost: [],
        unknownStored: [],
        dropFirstReply: [],
        refusedKeys: {},
        messageReadRefusal: null,
        sendAnswer: null,
        sessions: [],
        ...overrides,
      });

      onTestFinished(() => atc.stop());

      return atc;
    },
    createClient: (socketPath: string, timeoutMs = 1000) =>
      createAtcClient({ socketPath, client: 'stu-watch/0.1.0', timeoutMs }),
  };
}

test('it sends the hello with the contract major and the client name, then makes the call', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc();

  const answer = await ctx.createClient(atc.socketPath).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'FAULT disk:/: 97% full',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(answer).toStrictEqual({ kind: 'answered', body: { message: 'm-1', status: 'queued' } });
  expect(atc.hellos).toHaveLength(1);
  expect(atc.hellos[0]).toMatchObject({ client: 'stu-watch/0.1.0', major: 8 });
  expect(atc.stored.map((message) => message.text)).toStrictEqual(['FAULT disk:/: 97% full']);
});

test('it answers refused with the code and data of the daemon refusal', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc({ refusedKeys: { 0: 'no_such_session' } });

  const answer = await ctx.createClient(atc.socketPath).write((procedures) =>
    procedures.session.message({
      session: 's-gone',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(answer).toStrictEqual({ kind: 'refused', code: 'no_such_session', data: {} });
});

test('it answers refused with protocol_mismatch when the daemon runs another major', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc({ major: 9 });

  const answer = await ctx
    .createClient(atc.socketPath)
    .read((procedures) => procedures.message.get({ message: 'm-1' }));

  expect(answer).toMatchObject({ kind: 'refused', code: 'protocol_mismatch' });
});

test('it answers unreached when no daemon listens at the socket', async () => {
  const ctx = await setupTest();

  const socketPath = join(ctx.folder, 'none.sock');

  const answer = await ctx
    .createClient(socketPath)
    .read((procedures) => procedures.message.get({ message: 'm-1' }));

  expect(answer).toStrictEqual({
    kind: 'unreached',
    reason: `no atc daemon answers at ${socketPath}`,
  });
});

test('it answers unreached when the daemon accepts the connection and never answers', async () => {
  const ctx = await setupTest();

  const socketPath = join(ctx.folder, 'hung.sock');
  const held: Socket[] = [];

  const server = createServer((socket) => {
    held.push(socket);
  });

  server.listen(socketPath);

  onTestFinished(() => {
    server.close();

    for (const socket of held) {
      socket.destroy();
    }
  });

  const answer = await ctx
    .createClient(socketPath, 100)
    .read((procedures) => procedures.message.get({ message: 'm-1' }));

  expect(answer.kind).toBe('unreached');
});

test('it answers unreached when the client fails locally with internal', async () => {
  const ctx = await setupTest();

  const folder = join(ctx.folder, 'locked');

  await mkdir(folder);
  await chmod(folder, 0o000);

  const answer = await ctx
    .createClient(join(folder, 'atc-daemon.sock'))
    .read((procedures) => procedures.message.get({ message: 'm-1' }));

  await chmod(folder, 0o700);

  expect(answer.kind).toBe('unreached');
});
