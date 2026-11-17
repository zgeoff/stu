import { expect, mock, test } from 'bun:test';
import type { HttpAnswer } from '@stu/model';
import { createHttpKind } from './create-http-kind.ts';

function setupTest() {
  return {
    createKind: (answer: HttpAnswer) =>
      createHttpKind({
        probeTCP: mock(() => Promise.reject(new Error('the http kind opens no tcp'))),
        readHTTP: mock(() => Promise.resolve(answer)),
      }),
  };
}

test.each([200, 302])('it sees no fault for a %d answer', async (status) => {
  const ctx = setupTest();

  const faults = await ctx.createKind({ kind: 'answered', status })({
    url: 'https://app.example/health',
  });

  expect(faults).toStrictEqual([]);
});

test('it sees one fault keyed by the url for a 503 answer', async () => {
  const ctx = setupTest();

  const faults = await ctx.createKind({ kind: 'answered', status: 503 })({
    url: 'https://app.example/health',
  });

  expect(faults).toStrictEqual([
    { key: 'https://app.example/health', line: 'GET https://app.example/health answered 503' },
  ]);
});

test('it sees a fault for any status but the one the params name', async () => {
  const ctx = setupTest();

  const faults = await ctx.createKind({ kind: 'answered', status: 200 })({
    url: 'https://app.example/health',
    status: 204,
  });

  expect(faults).toStrictEqual([
    { key: 'https://app.example/health', line: 'GET https://app.example/health answered 200' },
  ]);
});

test('it sees one fault with the reason when the url gives no answer', async () => {
  const ctx = setupTest();

  const faults = await ctx.createKind({ kind: 'unreached', reason: 'connection refused' })({
    url: 'https://app.example/health',
  });

  expect(faults).toStrictEqual([
    {
      key: 'https://app.example/health',
      line: 'GET https://app.example/health got no answer: connection refused',
    },
  ]);
});
