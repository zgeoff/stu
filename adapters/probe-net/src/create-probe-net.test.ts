import { expect, onTestFinished, test } from 'bun:test';
import { createProbeNet } from './create-probe-net.ts';
import { startStubHTTP } from './test-utils/start-stub-http.ts';
import { startStubTCP } from './test-utils/start-stub-tcp.ts';

function setupTest() {
  return { net: createProbeNet() };
}

test('#probeTCP answers true for a port that takes connections', async () => {
  const ctx = setupTest();

  const listener = await startStubTCP();

  onTestFinished(() => listener.stop());

  const reached = await ctx.net.probeTCP('127.0.0.1', listener.port, { timeoutMs: 1000 });

  expect(reached).toBeTrue();
});

test('#probeTCP answers false for a closed port', async () => {
  const ctx = setupTest();

  const listener = await startStubTCP();

  await listener.stop();

  const reached = await ctx.net.probeTCP('127.0.0.1', listener.port, { timeoutMs: 1000 });

  expect(reached).toBeFalse();
});

test('#readHTTP answers with the status the server gives, without following a redirect', async () => {
  const ctx = setupTest();

  const listener = await startStubHTTP(302);

  onTestFinished(() => listener.stop());

  const answer = await ctx.net.readHTTP(`http://127.0.0.1:${listener.port}/`, { timeoutMs: 1000 });

  expect(answer).toStrictEqual({ kind: 'answered', status: 302 });
});

test('#readHTTP answers unreached for a server that gives no answer within the timeout', async () => {
  const ctx = setupTest();

  const listener = await startStubHTTP(null);

  onTestFinished(() => listener.stop());

  const answer = await ctx.net.readHTTP(`http://127.0.0.1:${listener.port}/`, { timeoutMs: 100 });

  expect(answer).toStrictEqual({ kind: 'unreached', reason: expect.any(String) });
});
