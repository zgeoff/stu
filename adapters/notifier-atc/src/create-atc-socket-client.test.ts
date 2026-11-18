import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAtcSocketClient } from './create-atc-socket-client.ts';
import { startStubAtc } from './test-utils/start-stub-atc.ts';
import type { StubAtcRules } from './test-utils/start-stub-atc.ts';
import type { AtcSocketPaths } from './types.ts';

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
    createClient: (socketPaths: AtcSocketPaths) =>
      createAtcSocketClient({ socketPaths, client: 'stu-watch/0.1.0', timeoutMs: 200 }),
  };
}

test('it says hello with its client name and protocol 14 before the call', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  await ctx.createClient([atc.socketPath]).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(atc.hellos).toStrictEqual([{ client: 'stu-watch/0.1.0', protocol: 14 }]);
});

test('it retries once with the daemon protocol that a protocol_mismatch refusal gives', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 15,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  await ctx.createClient([atc.socketPath]).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(atc.hellos.map((hello) => hello['protocol'])).toStrictEqual([14, 15]);
  expect(atc.stored).toHaveLength(1);
});

test('it answers refused with the atc code and data of a refusal', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  const answer = await ctx
    .createClient([atc.socketPath])
    .read((procedures) => procedures.message.get({ message: 'm-9' }));

  expect(answer).toStrictEqual({ kind: 'refused', code: 'bad_args', data: {} });
});

test('it answers unreached when atc closes the connection before it answers', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  const answer = await ctx.createClient([atc.socketPath]).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
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

test('it answers unreached when atc gives no answer within the timeout', async () => {
  const ctx = await setupTest();

  const silent = createServer(() => {});
  const socketPath = join(ctx.folder, 'silent.sock');

  silent.listen(socketPath);

  onTestFinished(() => silent.close());

  const answer = await ctx
    .createClient([socketPath])
    .read((procedures) => procedures.session.list({}));

  expect(answer).toStrictEqual({ kind: 'unreached', reason: 'atc gave no answer in 200 ms' });
});

test('it answers unreached when atc writes a line that is not JSON', async () => {
  const ctx = await setupTest();

  const broken = createServer((socket) => {
    socket.on('data', () => {
      socket.write('not json\n');
    });
  });

  const socketPath = join(ctx.folder, 'broken.sock');

  broken.listen(socketPath);

  onTestFinished(() => broken.close());

  const answer = await ctx
    .createClient([socketPath])
    .read((procedures) => procedures.session.list({}));

  expect(answer).toStrictEqual({
    kind: 'unreached',
    reason: 'atc closed the connection before it answered',
  });
});

test('it answers unreached when atc closes the connection as soon as it accepts it', async () => {
  const ctx = await setupTest();

  const closing = createServer((socket) => {
    socket.destroy();
  });

  const socketPath = join(ctx.folder, 'closing.sock');

  closing.listen(socketPath);

  onTestFinished(() => closing.close());

  const answer = await ctx
    .createClient([socketPath])
    .read((procedures) => procedures.session.list({}));

  expect(answer).toStrictEqual({ kind: 'unreached', reason: expect.any(String) });
});

test('it answers unreached with each path it tried when no daemon listens at any of them', async () => {
  const ctx = await setupTest();

  const first = join(ctx.folder, 'run', 'atc-daemon.sock');
  const second = join(ctx.folder, 'state', 'atc-daemon.sock');

  const answer = await ctx
    .createClient([first, second])
    .read((procedures) => procedures.session.list({}));

  expect(answer).toStrictEqual({
    kind: 'unreached',
    reason: `no atc daemon listens at ${first} or ${second}`,
  });
});

test('it calls the daemon at the next path when none listens at the first', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  await ctx
    .createClient([join(ctx.folder, 'run', 'atc-daemon.sock'), atc.socketPath])
    .write((procedures) =>
      procedures.session.message({
        session: 's-stu',
        text: 'hi',
        from: 'stu-watch',
        idempotencyKey: 'k1',
      }),
    );

  expect(atc.stored).toStrictEqual([
    { id: 'm-1', session: 's-stu', text: 'hi', from: 'stu-watch', idempotencyKey: 'k1' },
  ]);
});

test('it calls the daemon at the next path when the first holds a socket file no daemon listens on', async () => {
  const ctx = await setupTest();

  const stale = join(ctx.folder, 'stale-atc-daemon.sock');

  await writeFile(stale, '');

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  await ctx.createClient([stale, atc.socketPath]).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(atc.stored).toStrictEqual([
    { id: 'm-1', session: 's-stu', text: 'hi', from: 'stu-watch', idempotencyKey: 'k1' },
  ]);
});

test('it answers unreached without trying the next path when the connect fails for another cause', async () => {
  const ctx = await setupTest();

  const atc = await ctx.startAtc({
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
    refusedKeys: {},
    messageReadRefusal: null,
    sendAnswer: null,
  });

  const overlong = join(ctx.folder, 'x'.repeat(200), 'atc-daemon.sock');

  const answer = await ctx.createClient([overlong, atc.socketPath]).write((procedures) =>
    procedures.session.message({
      session: 's-stu',
      text: 'hi',
      from: 'stu-watch',
      idempotencyKey: 'k1',
    }),
  );

  expect(answer).toStrictEqual({
    kind: 'unreached',
    reason: expect.stringContaining(`atc connect failed at ${overlong}: `),
  });

  expect(atc.hellos).toStrictEqual([]);
});
