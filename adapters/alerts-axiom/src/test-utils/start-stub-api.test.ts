import { expect, onTestFinished, test } from 'bun:test';
import { startStubAPI } from './start-stub-api.ts';

test('it answers a path with each of its responses in turn', async () => {
  const api = startStubAPI({ '/a': [new Response('one'), new Response('two')] });

  onTestFinished(() => api.stop());

  await fetch(`${api.url}/a`);

  const second = await fetch(`${api.url}/a`);

  expect(second.text()).resolves.toBe('two');
});

test('it answers 500 once a path has no responses left', async () => {
  const api = startStubAPI({ '/a': [new Response('one')] });

  onTestFinished(() => api.stop());

  await fetch(`${api.url}/a`);

  const second = await fetch(`${api.url}/a`);

  expect(second.status).toBe(500);
});

test('it answers 500 for a path it has no responses for', async () => {
  const api = startStubAPI({});

  onTestFinished(() => api.stop());

  const response = await fetch(`${api.url}/b`);

  expect(response.status).toBe(500);
});

test('it records the method, path, query, headers and body of each request', async () => {
  const api = startStubAPI({ '/a': [new Response('one')] });

  onTestFinished(() => api.stop());

  await fetch(`${api.url}/a?x=1`, { method: 'POST', headers: { 'x-test': 'yes' }, body: 'hi' });

  expect(api.requests).toStrictEqual([
    {
      method: 'POST',
      target: '/a?x=1',
      headers: expect.objectContaining({ 'x-test': 'yes' }),
      body: 'hi',
    },
  ]);
});
