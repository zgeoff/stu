import { expect, mock, test } from 'bun:test';
import { makeTCPKind } from './make-tcp-kind.ts';

function setupTest() {
  return {
    makeKind: (reached: boolean) =>
      makeTCPKind({
        probeTCP: mock(() => Promise.resolve(reached)),
        readHTTP: mock(() => Promise.reject(new Error('the tcp kind reads no http'))),
      }),
  };
}

test('it sees one fault keyed by host and port when the port gives no answer', async () => {
  const ctx = setupTest();

  const faults = await ctx.makeKind(false)({ host: 'tunnel-a.example', port: 2222 });

  expect(faults).toStrictEqual([
    { key: 'tunnel-a.example:2222', line: 'no answer from tunnel-a.example:2222' },
  ]);
});

test('it sees no fault when the port takes the connection', async () => {
  const ctx = setupTest();

  const faults = await ctx.makeKind(true)({ host: 'tunnel-a.example', port: 2222 });

  expect(faults).toStrictEqual([]);
});

test('it throws on params without a port', () => {
  const ctx = setupTest();

  expect(ctx.makeKind(true)({ host: 'tunnel-a.example' })).rejects.toThrow();
});
