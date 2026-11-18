import { expect, mock, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { FetchHTTP, Reported } from '@stu/model';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { makeQuotaAnthropicKind } from './make-quota-anthropic-kind.ts';

function setupTest() {
  return {
    makeKind: (fetch: FetchHTTP) => makeQuotaAnthropicKind({ fetch }),
  };
}

test('it posts a 1-token request with the slot token', async () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
    ],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  await kind({
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(anthropic.requests).toStrictEqual([
    {
      method: 'POST',
      target: '/v1/messages',
      headers: expect.objectContaining({
        authorization: 'Bearer test-slot-token-a',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
      }),
      body: '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}',
    },
  ]);
});

test('it gives no fault for a slot whose 7-day use is under the line', async () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [
      new Response(null, { headers: { 'anthropic-ratelimit-unified-7d-utilization': '0.31' } }),
    ],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  const faults = await kind({
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(faults).toStrictEqual([]);
});

test('it gives one fault for the slot whose 429 carries a full 7-day use', async () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [
      new Response(null, { headers: { 'anthropic-ratelimit-unified-7d-utilization': '0.05' } }),
      new Response('{"type":"error"}', {
        status: 429,
        headers: {
          'anthropic-ratelimit-unified-7d-utilization': '1.0',
          'anthropic-ratelimit-unified-7d-status': 'rejected',
        },
      }),
    ],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  const faults = await kind({
    sevenPct: 85,
    slots: [
      { id: 'slot-a', token: 'test-slot-token-a' },
      { id: 'slot-b', token: 'test-slot-token-b' },
    ],
  });

  expect(faults).toStrictEqual([
    { key: 'slot-b', line: 'Claude slot slot-b is over its limit: 7-day 100% (line 85%)' },
  ]);
});

test('it sends the request of every slot before any of them answers', () => {
  const ctx = setupTest();
  const pending = Promise.withResolvers<Response>();
  const slowFetch = mock<FetchHTTP>(() => pending.promise);
  const kind = ctx.makeKind(slowFetch);

  void kind({
    sevenPct: 85,
    slots: [
      { id: 'slot-a', token: 'test-slot-token-a' },
      { id: 'slot-b', token: 'test-slot-token-b' },
    ],
  });

  expect(
    slowFetch.mock.calls.map(([, init]) => new Headers(init.headers).get('authorization')),
  ).toStrictEqual(['Bearer test-slot-token-a', 'Bearer test-slot-token-b']);
});

test('it throws naming the slot when a 429 has no use headers', () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [new Response('{"type":"error"}', { status: 429 })],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  const faults = kind({
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'slot slot-a: the messages API answered 429 with no usage headers',
  );
});

test('it throws naming the slot and status when the answer has no use headers', () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [new Response('{"type":"error"}', { status: 401 })],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  const faults = kind({
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'slot slot-a: the messages API answered 401 with no usage headers',
  );
});

test('it throws naming only the slot and the error name when the messages API gives no answer', () => {
  const ctx = setupTest();
  const anthropic = buildStubFetch({ '/v1/messages': [new TypeError('fetch failed')] });
  const kind = ctx.makeKind(anthropic.fetch);

  const faults = kind({
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'slot slot-a: the messages API gave no answer (TypeError)',
  );
});

test('it asks for each slot once over 30 one-minute runs of a check at everyMin 30', async () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
    ],
  });

  const kind = ctx.makeKind(anthropic.fetch);

  const checks = [
    {
      id: 'claude-quota',
      kind: 'quota-anthropic',
      everyMin: 30,
      sevenPct: 85,
      slots: [
        { id: 'slot-a', token: 'test-slot-token-a' },
        { id: 'slot-b', token: 'test-slot-token-b' },
      ],
    },
  ];

  const start = Temporal.Instant.from('2026-11-17T08:00:00Z');

  await Array.from({ length: 30 }, (_, minute) => start.add({ minutes: minute })).reduce(
    async (previous: Promise<Reported>, at) => {
      const result = await runWatch({
        checks,
        kinds: { 'quota-anthropic': kind },
        state: await previous,
        at,
        notifier: buildStubNotifier([{ kind: 'sent' }]),
        writeReported: () => Promise.resolve(),
      });

      return result.state;
    },
    Promise.resolve({ faults: {}, lastRun: {} }),
  );

  expect(anthropic.requests).toHaveLength(2);
});

test('it throws naming the key for an opServiceAccountToken param', () => {
  const ctx = setupTest();
  const kind = ctx.makeKind(buildStubFetch({}).fetch);

  const faults = kind({
    opServiceAccountToken: 'ops-test-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', token: 'test-slot-token-a' }],
  });

  expect(faults).rejects.toThrow('opServiceAccountToken');
});
