import { expect, mock, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { FetchHTTP, Reported, RunProgram } from '@stu/model';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { makeQuotaAnthropicKind } from './make-quota-anthropic-kind.ts';

function setupTest() {
  const run = mock<RunProgram>(() => Promise.resolve({ code: 0, stdout: 'test-slot-token\n' }));

  return {
    run,
    makeKind: (fetch: FetchHTTP, kindRun: RunProgram) =>
      makeQuotaAnthropicKind({
        run: kindRun,
        fetch,
        opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
      }),
  };
}

test('it reads each slot token with op and posts a 1-token request with it', async () => {
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

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  await kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect([ctx.run.mock.calls, anthropic.requests]).toStrictEqual([
    [
      [
        ['op', 'read', 'op://vault-test/item-a/credential'],
        {
          env: {
            PATH: '/usr/bin',
            HOME: '/tmp/stu-test',
            OP_SERVICE_ACCOUNT_TOKEN: 'op-test-service-token',
          },
          timeoutMs: 10_000,
        },
      ],
    ],
    [
      {
        method: 'POST',
        target: '/v1/messages',
        headers: expect.objectContaining({
          authorization: 'Bearer test-slot-token',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        }),
        body: '{"model":"claude-haiku-4-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}',
      },
    ],
  ]);
});

test('it gives no fault for a slot whose 7-day use is under the line', async () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [
      new Response(null, { headers: { 'anthropic-ratelimit-unified-7d-utilization': '0.31' } }),
    ],
  });

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const faults = await kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
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

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const faults = await kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [
      { id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' },
      { id: 'slot-b', tokenRef: 'op://vault-test/item-b/credential' },
    ],
  });

  expect(faults).toStrictEqual([
    { key: 'slot-b', line: 'Claude slot slot-b is over its limit: 7-day 100% (line 85%)' },
  ]);
});

test('it starts the op read of every slot before any of them finishes', () => {
  const ctx = setupTest();
  const pending = Promise.withResolvers<{ code: number; stdout: string }>();
  const slowRun = mock<RunProgram>(() => pending.promise);
  const kind = ctx.makeKind(buildStubFetch({}).fetch, slowRun);

  void kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [
      { id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' },
      { id: 'slot-b', tokenRef: 'op://vault-test/item-b/credential' },
    ],
  });

  expect(slowRun.mock.calls.map(([argv]) => argv)).toStrictEqual([
    ['op', 'read', 'op://vault-test/item-a/credential'],
    ['op', 'read', 'op://vault-test/item-b/credential'],
  ]);
});

test('it reads four slots whose answers each wait until all four requests have arrived', async () => {
  const ctx = setupTest();

  const slotTokens: Readonly<Record<string, string>> = {
    'op://vault-test/item-a/credential': 'test-token-a',
    'op://vault-test/item-b/credential': 'test-token-b',
    'op://vault-test/item-c/credential': 'test-token-c',
    'op://vault-test/item-d/credential': 'test-token-d',
  };

  const sevenDayUse: Readonly<Record<string, string>> = {
    'Bearer test-token-a': '0.86',
    'Bearer test-token-b': '0.87',
    'Bearer test-token-c': '0.88',
    'Bearer test-token-d': '0.89',
  };

  const tokenRun = mock<RunProgram>((argv) =>
    Promise.resolve({ code: 0, stdout: `${slotTokens[argv[2] ?? ''] ?? ''}\n` }),
  );

  const arrivals = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
  let arrivedCount = 0;

  const heldFetch: FetchHTTP = async (_url, init) => {
    arrivals[arrivedCount++]?.resolve();

    await Promise.all(arrivals.map((arrival) => arrival.promise));

    return new Response(null, {
      headers: {
        'anthropic-ratelimit-unified-7d-utilization':
          sevenDayUse[new Headers(init.headers).get('authorization') ?? ''] ?? '',
      },
    });
  };

  const kind = ctx.makeKind(heldFetch, tokenRun);

  const faults = await kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [
      { id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' },
      { id: 'slot-b', tokenRef: 'op://vault-test/item-b/credential' },
      { id: 'slot-c', tokenRef: 'op://vault-test/item-c/credential' },
      { id: 'slot-d', tokenRef: 'op://vault-test/item-d/credential' },
    ],
  });

  expect(faults).toStrictEqual([
    { key: 'slot-a', line: 'Claude slot slot-a is over its limit: 7-day 86% (line 85%)' },
    { key: 'slot-b', line: 'Claude slot slot-b is over its limit: 7-day 87% (line 85%)' },
    { key: 'slot-c', line: 'Claude slot slot-c is over its limit: 7-day 88% (line 85%)' },
    { key: 'slot-d', line: 'Claude slot slot-d is over its limit: 7-day 89% (line 85%)' },
  ]);
});

test('it throws naming the slot when a 429 has no use headers', () => {
  const ctx = setupTest();

  const anthropic = buildStubFetch({
    '/v1/messages': [new Response('{"type":"error"}', { status: 429 })],
  });

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
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

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'slot slot-a: the messages API answered 401 with no usage headers',
  );
});

test('it throws without the reference or any token when op read exits 1', () => {
  const ctx = setupTest();

  const failingRun = mock<RunProgram>(() =>
    Promise.resolve({ code: 1, stdout: 'op-test-service-token op://vault-test/item-a' }),
  );

  const kind = ctx.makeKind(buildStubFetch({}).fetch, failingRun);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).rejects.toThrowWithMessage(Error, 'slot slot-a: op read failed (exit 1)');
});

test('it throws naming only the slot and the error name when the messages API gives no answer', () => {
  const ctx = setupTest();
  const anthropic = buildStubFetch({ '/v1/messages': [new TypeError('fetch failed')] });
  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'slot slot-a: the messages API gave no answer (TypeError)',
  );
});

test('it throws when op read exits 0 with an empty token', () => {
  const ctx = setupTest();
  const emptyRun = mock<RunProgram>(() => Promise.resolve({ code: 0, stdout: '\n' }));
  const kind = ctx.makeKind(buildStubFetch({}).fetch, emptyRun);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).rejects.toThrowWithMessage(Error, 'slot slot-a: op read failed (exit 0)');
});

test('it reads each slot once over 30 one-minute runs of a check at everyMin 30', async () => {
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

  const kind = ctx.makeKind(anthropic.fetch, ctx.run);

  const checks = [
    {
      id: 'claude-quota',
      kind: 'quota-anthropic',
      everyMin: 30,
      opServiceAccountToken: 'op-test-service-token',
      sevenPct: 85,
      slots: [
        { id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' },
        { id: 'slot-b', tokenRef: 'op://vault-test/item-b/credential' },
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

  expect(ctx.run.mock.calls.map(([argv]) => argv)).toStrictEqual([
    ['op', 'read', 'op://vault-test/item-a/credential'],
    ['op', 'read', 'op://vault-test/item-b/credential'],
  ]);
});
