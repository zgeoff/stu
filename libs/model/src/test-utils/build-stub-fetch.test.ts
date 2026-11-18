import { expect, test } from 'bun:test';
import { buildStubFetch } from './build-stub-fetch.ts';

test('it answers a path with each of its answers in turn, whatever the host', async () => {
  const stub = buildStubFetch({ '/a': [new Response('one'), new Response('two')] });

  await stub.fetch(new URL('https://first.example.invalid/a'), {});

  const second = await stub.fetch(new URL('https://second.example.invalid/a'), {});

  expect(second.text()).resolves.toBe('two');
});

test('it rejects with an Error answer', () => {
  const stub = buildStubFetch({ '/a': [new TypeError('connection refused')] });
  const answer = stub.fetch(new URL('https://api.example.invalid/a'), {});

  expect(answer).rejects.toThrowWithMessage(TypeError, 'connection refused');
});

test('it rejects once a path has no answers left', async () => {
  const stub = buildStubFetch({ '/a': [new Response('one')] });

  await stub.fetch(new URL('https://api.example.invalid/a'), {});

  const second = stub.fetch(new URL('https://api.example.invalid/a'), {});

  expect(second).rejects.toThrow();
});

test('it rejects a path it has no answers for', () => {
  const stub = buildStubFetch({});
  const answer = stub.fetch(new URL('https://api.example.invalid/b'), {});

  expect(answer).rejects.toThrowWithMessage(Error, 'the stub fetch has no answers for /b');
});

test('it records the method, path, query, headers and body of each request', async () => {
  const stub = buildStubFetch({ '/a': [new Response('one')] });

  await stub.fetch(new URL('https://api.example.invalid/a?x=1'), {
    method: 'POST',
    headers: { 'x-test': 'yes' },
    body: 'hi',
  });

  expect(stub.requests).toStrictEqual([
    { method: 'POST', target: '/a?x=1', headers: { 'x-test': 'yes' }, body: 'hi' },
  ]);
});
