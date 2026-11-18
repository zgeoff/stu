import { expect, onTestFinished, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { Reported } from '@stu/model';
import { makeAxiomAlertsKind } from './make-axiom-alerts-kind.ts';
import { startStubAPI } from './test-utils/start-stub-api.ts';

function setupTest() {
  const file: { state: Reported } = { state: { faults: {}, lastRun: {} } };
  const clock = { nowMs: 0 };
  const notifier = buildStubNotifier([{ kind: 'sent' }]);
  const kind = makeAxiomAlertsKind({ readNowMs: () => clock.nowMs });

  return {
    clock,
    kind,
    notifier,
    runAt: async (at: string, apiURL: string) => {
      clock.nowMs = Temporal.Instant.from(at).epochMilliseconds;

      const result = await runWatch({
        checks: [
          { id: 'axiom', kind: 'alerts-axiom', everyMin: 5, apiURL, token: 'xaat-test-token' },
        ],
        kinds: { 'alerts-axiom': kind },
        state: file.state,
        at: Temporal.Instant.from(at),
        notifier,
        writeReported: () => Promise.resolve(),
      });

      file.state = result.state;
    },
  };
}

test('it sends stu one open while a monitor triggers and one recovery once it resolves', async () => {
  const ctx = setupTest();

  const axiom = startStubAPI({
    '/v2/monitors': [
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold', labelIds: [] }]),
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold', labelIds: [] }]),
    ],
    '/v2/monitors/mon_a1/history': [
      Response.json([
        {
          checkId: 'mon_a1',
          name: 'Resolved: API errors',
          state: 'closed',
          timestamp: '2026-11-16T10:00:00Z',
        },
        {
          checkId: 'mon_a1',
          name: 'Triggered: API errors',
          state: 'open',
          timestamp: '2026-11-17T07:58:00Z',
        },
      ]),
      Response.json([
        {
          checkId: 'mon_a1',
          name: 'Triggered: API errors',
          state: 'open',
          timestamp: '2026-11-17T07:58:00Z',
        },
        {
          checkId: 'mon_a1',
          name: 'Resolved: API errors',
          state: 'closed',
          timestamp: '2026-11-17T08:03:00Z',
        },
      ]),
    ],
  });

  onTestFinished(() => axiom.stop());

  await ctx.runAt('2026-11-17T08:00:00Z', axiom.url);
  await ctx.runAt('2026-11-17T08:05:00Z', axiom.url);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT axiom:mon_a1: Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
    'RECOVERED axiom:mon_a1 (failing since 2026-11-17T08:00:00.000Z): Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
  ]);
});

test('it asks for the last 30 days of history with the token', async () => {
  const ctx = setupTest();

  const axiom = startStubAPI({
    '/v2/monitors': [Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }])],
    '/v2/monitors/mon_a1/history': [Response.json([])],
  });

  onTestFinished(() => axiom.stop());

  ctx.clock.nowMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;

  await ctx.kind({ apiURL: axiom.url, token: 'xaat-test-token' });

  expect(
    axiom.requests.map((request) => [request.target, request.headers['authorization']]),
  ).toStrictEqual([
    ['/v2/monitors', 'Bearer xaat-test-token'],
    [
      '/v2/monitors/mon_a1/history?startTime=2026-10-18T08%3A00%3A00Z&endTime=2026-11-17T08%3A00%3A00Z',
      'Bearer xaat-test-token',
    ],
  ]);
});

test('it asks for no history of a disabled, a skip-resolved or a MatchEvent monitor, and gives no fault for them', async () => {
  const ctx = setupTest();

  const axiom = startStubAPI({
    '/v2/monitors': [
      Response.json([
        { id: 'mon_off', name: 'Off', type: 'Threshold', disabled: true },
        { id: 'mon_skip', name: 'Skips resolved', type: 'Threshold', skipResolved: true },
        { id: 'mon_match', name: 'Each match', type: 'MatchEvent' },
      ]),
    ],
  });

  onTestFinished(() => axiom.stop());

  const faults = await ctx.kind({ apiURL: axiom.url, token: 'xaat-test-token' });

  expect([faults, axiom.requests.map((request) => request.target)]).toStrictEqual([
    [],
    ['/v2/monitors'],
  ]);
});

test('it throws for a monitor type it does not know', () => {
  const ctx = setupTest();

  const axiom = startStubAPI({
    '/v2/monitors': [Response.json([{ id: 'mon_w', name: 'Hook', type: 'Webhook' }])],
  });

  onTestFinished(() => axiom.stop());

  const faults = ctx.kind({ apiURL: axiom.url, token: 'xaat-test-token' });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'axiom gave an answer the kind cannot read for monitors',
  );
});

test('it sends no recovery and names only the status and monitor when one history call answers 502', async () => {
  const ctx = setupTest();

  const axiom = startStubAPI({
    '/v2/monitors': [
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }]),
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }]),
    ],
    '/v2/monitors/mon_a1/history': [
      Response.json([{ state: 'open', timestamp: '2026-11-17T07:58:00Z' }]),
      new Response('upstream at api.example.invalid failed', { status: 502 }),
    ],
  });

  onTestFinished(() => axiom.stop());

  await ctx.runAt('2026-11-17T08:00:00Z', axiom.url);
  await ctx.runAt('2026-11-17T08:05:00Z', axiom.url);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT axiom:mon_a1: Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
    'FAULT axiom: cannot run: axiom answered 502 for history of mon_a1',
  ]);
});

test('it throws without the url when Axiom gives no answer', async () => {
  const ctx = setupTest();
  const axiom = startStubAPI({});

  await axiom.stop();

  const faults = ctx.kind({ apiURL: axiom.url, token: 'xaat-test-token' });

  expect(faults).rejects.toThrowWithMessage(Error, /^axiom gave no answer for monitors \(\w+\)$/u);
});
