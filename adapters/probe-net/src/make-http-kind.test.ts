import { expect, test } from 'bun:test';
import { createProbeNet } from './create-probe-net.ts';
import { makeHTTPKind } from './make-http-kind.ts';
import { startStubHTTP } from './test-utils/start-stub-http.ts';

function setupTest() {
  return { kind: makeHTTPKind(createProbeNet()) };
}

test.each([200, 302])('it sees no fault for a %d answer', async (status) => {
  const ctx = setupTest();
  const server = startStubHTTP(status);

  const faults = await ctx.kind({ url: `http://127.0.0.1:${server.port}/health` });

  expect(faults).toStrictEqual([]);
});

test('it sees one fault keyed by the url for a 503 answer', async () => {
  const ctx = setupTest();
  const server = startStubHTTP(503);
  const url = `http://127.0.0.1:${server.port}/health`;

  const faults = await ctx.kind({ url });

  expect(faults).toStrictEqual([{ key: url, line: `GET ${url} answered 503` }]);
});

test('it sees a fault for any status but the one the params name', async () => {
  const ctx = setupTest();
  const server = startStubHTTP(200);
  const url = `http://127.0.0.1:${server.port}/health`;

  const faults = await ctx.kind({ url, status: 204 });

  expect(faults).toStrictEqual([{ key: url, line: `GET ${url} answered 200` }]);
});

test('it sees one fault with the reason when the url gives no answer', async () => {
  const ctx = setupTest();
  const server = startStubHTTP(200);

  await server.stop();

  const url = `http://127.0.0.1:${server.port}/health`;

  const faults = await ctx.kind({ url });

  expect(faults).toStrictEqual([
    { key: url, line: expect.stringMatching(new RegExp(`^GET ${url} got no answer: .+`, 'u')) },
  ]);
});
