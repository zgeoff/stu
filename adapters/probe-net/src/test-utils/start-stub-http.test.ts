import { expect, onTestFinished, test } from 'bun:test';
import { startStubHTTP } from './start-stub-http.ts';

test('it answers each request with its status and a redirect header', async () => {
  const listener = await startStubHTTP(302);

  onTestFinished(() => listener.stop());

  const response = await fetch(`http://127.0.0.1:${listener.port}/`, { redirect: 'manual' });

  expect([response.status, response.headers.get('location')]).toStrictEqual([302, '/elsewhere']);
});

test('it gives no answer when its status is null', async () => {
  const listener = await startStubHTTP(null);

  onTestFinished(() => listener.stop());

  const request = fetch(`http://127.0.0.1:${listener.port}/`, { signal: AbortSignal.timeout(100) });

  expect(request).rejects.toThrow();
});
