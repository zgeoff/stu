import { expect, mock, onTestFinished, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { Reported, RunProgram } from '@stu/model';
import { makeQuotaAnthropicKind } from './make-quota-anthropic-kind.ts';
import { startStubAPI } from './test-utils/start-stub-api.ts';

function setupTest() {
  const run = mock<RunProgram>(() => Promise.resolve({ code: 0, stdout: 'test-slot-token\n' }));

  return {
    run,
    makeKind: (messagesURL: string, kindRun: RunProgram) =>
      makeQuotaAnthropicKind({
        run: kindRun,
        messagesURL,
        opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
      }),
  };
}

test('it reads each slot token with op and posts a 1-token request with it', async () => {
  const ctx = setupTest();

  const anthropic = startStubAPI({
    '/v1/messages': [
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '0.1',
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
    ],
  });

  onTestFinished(() => anthropic.stop());

  const kind = ctx.makeKind(`${anthropic.url}/v1/messages`, ctx.run);

  await kind({
    opServiceAccountToken: 'op-test-service-token',
    fivePct: 90,
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
          timeoutMs: 30_000,
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
        body: '{"model":"claude-haiku-5-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}',
      },
    ],
  ]);
});

test('it counts a 429 that carries both use headers as a reading', async () => {
  const ctx = setupTest();

  const anthropic = startStubAPI({
    '/v1/messages': [
      new Response('{"type":"error"}', {
        status: 429,
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '1.0',
          'anthropic-ratelimit-unified-7d-utilization': '0.6',
        },
      }),
    ],
  });

  onTestFinished(() => anthropic.stop());

  const kind = ctx.makeKind(`${anthropic.url}/v1/messages`, ctx.run);

  const faults = await kind({
    opServiceAccountToken: 'op-test-service-token',
    fivePct: 90,
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).toStrictEqual([
    { key: 'slot-a', line: 'Claude slot slot-a is over its limit: 5-hour 100% (line 90%)' },
  ]);
});

test('it throws naming the slot and status when the answer has no use headers', () => {
  const ctx = setupTest();

  const anthropic = startStubAPI({
    '/v1/messages': [new Response('{"type":"error"}', { status: 401 })],
  });

  onTestFinished(() => anthropic.stop());

  const kind = ctx.makeKind(`${anthropic.url}/v1/messages`, ctx.run);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    fivePct: 90,
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

  const kind = ctx.makeKind('http://127.0.0.1:9/v1/messages', failingRun);

  const faults = kind({
    opServiceAccountToken: 'op-test-service-token',
    fivePct: 90,
    sevenPct: 85,
    slots: [{ id: 'slot-a', tokenRef: 'op://vault-test/item-a/credential' }],
  });

  expect(faults).rejects.toThrowWithMessage(Error, 'slot slot-a: op read failed (exit 1)');
});

test('it reads each slot once over 30 one-minute runs of a check at everyMin 30', async () => {
  const ctx = setupTest();

  const anthropic = startStubAPI({
    '/v1/messages': [
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '0.1',
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
      new Response(null, {
        headers: {
          'anthropic-ratelimit-unified-5h-utilization': '0.1',
          'anthropic-ratelimit-unified-7d-utilization': '0.2',
        },
      }),
    ],
  });

  onTestFinished(() => anthropic.stop());

  const kind = ctx.makeKind(`${anthropic.url}/v1/messages`, ctx.run);

  const checks = [
    {
      id: 'claude-quota',
      kind: 'quota-anthropic',
      everyMin: 30,
      opServiceAccountToken: 'op-test-service-token',
      fivePct: 90,
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
