import { expect, test } from 'bun:test';
import { startStubHTTP } from './start-stub-http.ts';

test('it answers each request with its status and a redirect header', async () => {
  const listener = startStubHTTP(302);

  const response = await fetch(`http://127.0.0.1:${listener.port}/`, { redirect: 'manual' });

  expect([response.status, response.headers.get('location')]).toStrictEqual([302, '/elsewhere']);
});

test('it gives no answer when its status is null', () => {
  const listener = startStubHTTP(null);
  const request = fetch(`http://127.0.0.1:${listener.port}/`, { signal: AbortSignal.timeout(100) });

  expect(request).rejects.toThrow();
});
