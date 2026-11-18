import { expect, test } from 'bun:test';
import { runWatch } from '@stu/faults';
import { buildStubNotifier } from '@stu/faults/test-utils/build-stub-notifier';
import type { FetchHTTP, Reported } from '@stu/model';
import { buildStubClock } from '@stu/model/test-utils/build-stub-clock';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { makeAxiomAlertsKind } from './make-axiom-alerts-kind.ts';

function setupTest() {
  const file: { state: Reported } = { state: { faults: {}, lastRun: {} } };
  const clock = { nowMs: 0 };
  const notifier = buildStubNotifier([{ kind: 'sent' }]);
  const readNowMs = () => clock.nowMs;

  // the kind's sleeps, which move their own time from 0
  const timers = buildStubClock(0);

  return {
    clock,
    timers,
    notifier,
    readFaults: (fetch: FetchHTTP, params: Readonly<Record<string, unknown>>) =>
      makeAxiomAlertsKind({ fetch, readNowMs, sleepMs: timers.sleepMs })(params),
    runAt: async (at: string, fetch: FetchHTTP) => {
      clock.nowMs = Temporal.Instant.from(at).epochMilliseconds;

      const result = await runWatch({
        checks: [
          {
            id: 'axiom',
            kind: 'alerts-axiom',
            everyMin: 5,
            apiURL: 'https://api.example.invalid',
            token: 'xaat-test-token',
          },
        ],
        kinds: {
          'alerts-axiom': makeAxiomAlertsKind({ fetch, readNowMs, sleepMs: timers.sleepMs }),
        },
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

  const axiom = buildStubFetch({
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

  await ctx.runAt('2026-11-17T08:00:00Z', axiom.fetch);
  await ctx.runAt('2026-11-17T08:05:00Z', axiom.fetch);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT axiom:mon_a1: Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
    'RECOVERED axiom:mon_a1 (failing since 2026-11-17T08:00:00.000Z): Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
  ]);
});

test('it asks for the last 30 days of history with the token', async () => {
  const ctx = setupTest();

  const axiom = buildStubFetch({
    '/v2/monitors': [Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }])],
    '/v2/monitors/mon_a1/history': [Response.json([])],
  });

  ctx.clock.nowMs = Temporal.Instant.from('2026-11-17T08:00:00Z').epochMilliseconds;

  await ctx.readFaults(axiom.fetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

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

  const axiom = buildStubFetch({
    '/v2/monitors': [
      Response.json([
        { id: 'mon_off', name: 'Off', type: 'Threshold', disabled: true },
        { id: 'mon_skip', name: 'Skips resolved', type: 'Threshold', skipResolved: true },
        { id: 'mon_match', name: 'Each match', type: 'MatchEvent' },
      ]),
    ],
  });

  const faults = await ctx.readFaults(axiom.fetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  expect([faults, axiom.requests.map((request) => request.target)]).toStrictEqual([
    [],
    ['/v2/monitors'],
  ]);
});

test('it throws for a monitor type it does not know', () => {
  const ctx = setupTest();

  const axiom = buildStubFetch({
    '/v2/monitors': [Response.json([{ id: 'mon_w', name: 'Hook', type: 'Webhook' }])],
  });

  const faults = ctx.readFaults(axiom.fetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'axiom gave an answer the kind cannot read for monitors',
  );
});

test('it sends no recovery and names only the status and monitor when one history call answers 502', async () => {
  const ctx = setupTest();

  const axiom = buildStubFetch({
    '/v2/monitors': [
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }]),
      Response.json([{ id: 'mon_a1', name: 'API errors', type: 'Threshold' }]),
    ],
    '/v2/monitors/mon_a1/history': [
      Response.json([{ state: 'open', timestamp: '2026-11-17T07:58:00Z' }]),
      new Response('upstream at api.example.invalid failed', { status: 502 }),
    ],
  });

  await ctx.runAt('2026-11-17T08:00:00Z', axiom.fetch);
  await ctx.runAt('2026-11-17T08:05:00Z', axiom.fetch);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT axiom:mon_a1: Axiom monitor "API errors" triggered at 2026-11-17T07:58:00Z',
    'FAULT axiom: cannot run: axiom answered 502 for history of mon_a1',
  ]);
});

test('it throws without the url when Axiom gives no answer', () => {
  const ctx = setupTest();
  const axiom = buildStubFetch({ '/v2/monitors': [new TypeError('fetch failed')] });

  const faults = ctx.readFaults(axiom.fetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  expect(faults).rejects.toThrowWithMessage(Error, /^axiom gave no answer for monitors \(\w+\)$/u);
});

test('it reads ten histories that each wait until four are in flight, never more than four at once', async () => {
  const ctx = setupTest();
  const ids = Array.from({ length: 10 }, (_, index) => `mon_${String(index + 1).padStart(2, '0')}`);
  const fourInFlight = Promise.withResolvers<void>();
  const inFlight = { now: 0, most: 0 };

  const heldFetch: FetchHTTP = async (url) => {
    if (url.pathname === '/v2/monitors') {
      return Response.json(ids.map((id) => ({ id, name: `Errors ${id}`, type: 'Threshold' })));
    }

    inFlight.now += 1;
    inFlight.most = Math.max(inFlight.most, inFlight.now);

    if (inFlight.now === 4) {
      fourInFlight.resolve();
    }

    await fourInFlight.promise;

    inFlight.now -= 1;

    return Response.json([{ state: 'open', timestamp: '2026-11-17T07:58:00Z' }]);
  };

  const faults = await ctx.readFaults(heldFetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  expect([faults, inFlight.most]).toStrictEqual([
    ids.map((id) => ({
      key: id,
      line: `Axiom monitor "Errors ${id}" triggered at 2026-11-17T07:58:00Z`,
    })),
    4,
  ]);
});

test('it throws naming a monitor at its 10-second limit when twenty histories hang', async () => {
  const ctx = setupTest();
  const ids = Array.from({ length: 20 }, (_, index) => `mon_${String(index + 1).padStart(2, '0')}`);

  const axiom = buildStubFetch({
    '/v2/monitors': [
      Response.json(ids.map((id) => ({ id, name: `Errors ${id}`, type: 'Threshold' }))),
    ],
    ...Object.fromEntries(ids.map((id) => [`/v2/monitors/${id}/history`, ['hang' as const]])),
  });

  const faults = ctx.readFaults(axiom.fetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  await ctx.timers.passSleepsUntilSettled(faults);

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'axiom gave no answer for history of mon_01 (TimeoutError)',
  );

  expect(ctx.timers.readNowMs()).toBe(10_000);
});

test('it throws naming a monitor at its 25-second deadline when each history answers in 9 seconds', async () => {
  const ctx = setupTest();
  const ids = Array.from({ length: 20 }, (_, index) => `mon_${String(index + 1).padStart(2, '0')}`);

  const slowFetch: FetchHTTP = async (url, init) => {
    if (url.pathname === '/v2/monitors') {
      return Response.json(ids.map((id) => ({ id, name: `Errors ${id}`, type: 'Threshold' })));
    }

    await ctx.timers.sleepMs(9000, init.signal ?? new AbortController().signal);

    return Response.json([]);
  };

  const faults = ctx.readFaults(slowFetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  await ctx.timers.passSleepsUntilSettled(faults);

  expect(faults).rejects.toThrowWithMessage(
    Error,
    'axiom gave no answer for history of mon_09 (TimeoutError)',
  );

  expect(ctx.timers.readNowMs()).toBe(25_000);
});

test('it starts no history read after one fails', async () => {
  const ctx = setupTest();
  const ids = Array.from({ length: 6 }, (_, index) => `mon_${String(index + 1).padStart(2, '0')}`);
  const failed = Promise.withResolvers<void>();
  const asked: string[] = [];

  const heldFetch: FetchHTTP = async (url) => {
    if (url.pathname === '/v2/monitors') {
      return Response.json(ids.map((id) => ({ id, name: `Errors ${id}`, type: 'Threshold' })));
    }

    asked.push(url.pathname);

    if (url.pathname === '/v2/monitors/mon_01/history') {
      return new Response(null, { status: 502 });
    }

    await failed.promise;

    return Response.json([]);
  };

  const faults = ctx.readFaults(heldFetch, {
    apiURL: 'https://api.example.invalid',
    token: 'xaat-test-token',
  });

  await faults.catch(() => failed.resolve());
  await ctx.timers.passSleepsUntilSettled(Promise.resolve());

  expect(asked).toStrictEqual([
    '/v2/monitors/mon_01/history',
    '/v2/monitors/mon_02/history',
    '/v2/monitors/mon_03/history',
    '/v2/monitors/mon_04/history',
  ]);
});
