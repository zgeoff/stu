import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { startStubAtc } from './start-stub-atc.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
  });

  onTestFinished(() => atc.stop());

  const socket = createConnection({ path: atc.socketPath });

  onTestFinished(() => socket.destroy());

  return {
    atc,
    lines: createInterface({ input: socket })[Symbol.asyncIterator](),
    write: (line: string) => socket.write(line),
  };
}

// The request lines below are the ones atc's own tests record for its peer client.
test('it answers a hello in the peer framing atc writes', async () => {
  const ctx = await setupTest();

  ctx.write(
    '{"i":"1","p":{"u":"/daemon/hello","b":{"json":{"client":"atc/test","protocol":14}}}}\n',
  );

  const answer = await ctx.lines.next();

  expect(answer.value).toBe('{"i":"1","p":{"b":{"json":{"peerSession":null}}}}');
});

test('it refuses a hello on another protocol with status 400 and the daemon version in data', async () => {
  const ctx = await setupTest();

  ctx.write(
    '{"i":"1","p":{"u":"/daemon/hello","b":{"json":{"client":"atc/test","protocol":9}}}}\n',
  );

  const answer = await ctx.lines.next();

  expect(answer.value).toBe(
    '{"i":"1","p":{"s":400,"b":{"json":{"defined":false,"code":"protocol_mismatch","status":400,"message":"stub atc: protocol_mismatch","data":{"daemonProtocol":14,"clientProtocol":9}}}}}',
  );
});

test('it stores a message once and replays its key on a resend', async () => {
  const ctx = await setupTest();

  const send =
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n';

  ctx.write(send);

  await ctx.lines.next();

  ctx.write(send);

  const replay = await ctx.lines.next();

  expect([replay.value, ctx.atc.stored]).toStrictEqual([
    '{"i":"2","p":{"b":{"json":{"message":"m-1","status":"queued"}}}}',
    [{ id: 'm-1', session: 's1', text: 'hi', from: 'stu-watch', idempotencyKey: 'k1' }],
  ]);
});

test('it answers idempotency_conflict for a held key sent to another session', async () => {
  const ctx = await setupTest();

  ctx.write(
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  await ctx.lines.next();

  ctx.write(
    '{"i":"3","p":{"u":"/session/message","b":{"json":{"session":"s2","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  const conflict = await ctx.lines.next();

  expect(conflict.value).toInclude('"code":"idempotency_conflict"');
});

test('it answers bad_args for a message it does not hold', async () => {
  const ctx = await setupTest();

  ctx.write('{"i":"4","p":{"u":"/message/get","b":{"json":{"message":"m-9"}}}}\n');

  const miss = await ctx.lines.next();

  expect(miss.value).toInclude('{"s":400,"b":{"json":{"defined":false,"code":"bad_args"');
});

test('it stores a message whose reply it drops, and closes the connection without an answer', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [0],
  });

  onTestFinished(() => atc.stop());

  const socket = createConnection({ path: atc.socketPath });

  socket.write(
    '{"i":"2","p":{"u":"/session/message","b":{"json":{"session":"s1","text":"hi","from":"stu-watch","idempotencyKey":"k1"}}}}\n',
  );

  await once(socket, 'close');

  expect(atc.stored).toHaveLength(1);
});
