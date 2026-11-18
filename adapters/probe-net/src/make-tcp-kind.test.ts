import { expect, onTestFinished, test } from 'bun:test';
import { createProbeNet } from './create-probe-net.ts';
import { makeTCPKind } from './make-tcp-kind.ts';
import { startStubTCP } from './test-utils/start-stub-tcp.ts';

function setupTest() {
  return { kind: makeTCPKind(createProbeNet()) };
}

test('it sees one fault keyed by host and port when the port gives no answer', async () => {
  const ctx = setupTest();

  const listener = await startStubTCP();

  await listener.stop();

  const faults = await ctx.kind({ host: '127.0.0.1', port: listener.port });

  expect(faults).toStrictEqual([
    { key: `127.0.0.1:${listener.port}`, line: `no answer from 127.0.0.1:${listener.port}` },
  ]);
});

test('it sees no fault when the port takes the connection', async () => {
  const ctx = setupTest();

  const listener = await startStubTCP();

  onTestFinished(() => listener.stop());

  const faults = await ctx.kind({ host: '127.0.0.1', port: listener.port });

  expect(faults).toStrictEqual([]);
});

test('it throws on params without a port', () => {
  const ctx = setupTest();

  expect(ctx.kind({ host: '127.0.0.1' })).rejects.toThrow();
});
