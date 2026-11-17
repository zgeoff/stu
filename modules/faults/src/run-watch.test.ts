import { expect, test } from 'bun:test';
import type {
  CheckConfig,
  KindTable,
  Notifier,
  OwedMessage,
  Reported,
  SendOutcome,
} from '@stu/model';
import { runWatch } from './run-watch.ts';
import { buildStubNotifier } from './test-utils/build-stub-notifier.ts';
import { makeStubKind } from './test-utils/make-stub-kind.ts';

function setupTest() {
  const empty: Reported = { faults: {}, lastRun: {} };
  const file = { state: empty, saves: 0 };

  return {
    file,
    notifier: buildStubNotifier([{ kind: 'sent' }]),
    runAt: (at: string, checks: readonly CheckConfig[], kinds: KindTable, notifier: Notifier) =>
      runWatch({
        checks,
        kinds,
        state: file.state,
        at: Temporal.Instant.from(at),
        checkTimeoutMs: 1000,
        notifier,
        writeReported: (next) => {
          file.state = next;
          file.saves += 1;

          return Promise.resolve();
        },
      }),
  };
}

test('it sends stu one FAULT message when a check goes from passing to failing', async () => {
  const ctx = setupTest();
  const kinds = { disk: makeStubKind([[], [{ key: '/home', line: '/home is 95% full' }]]) };
  const checks = [{ id: 'disk-main', kind: 'disk' }];

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent).toStrictEqual([
    {
      text: 'FAULT disk-main:/home: /home is 95% full',
      idempotencyKey: expect.stringMatching(/^stu-watch:[0-9a-f]{32}$/u),
    },
  ]);
});

test('it sends stu one RECOVERED message when the failing check passes again', async () => {
  const ctx = setupTest();
  const kinds = { disk: makeStubKind([[{ key: '/home', line: '/home is 95% full' }], []]) };
  const checks = [{ id: 'disk-main', kind: 'disk' }];

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent).toStrictEqual([
    {
      text: 'FAULT disk-main:/home: /home is 95% full',
      idempotencyKey: expect.stringMatching(/^stu-watch:[0-9a-f]{32}$/u),
    },
    {
      text: 'RECOVERED disk-main:/home (failing since 2026-11-17T08:00:00.000Z): /home is 95% full',
      idempotencyKey: expect.stringMatching(/^stu-watch:[0-9a-f]{32}$/u),
    },
  ]);
});

test('it sends one message over 5 runs of a fault that stays failing', async () => {
  const ctx = setupTest();
  const fault = { key: '/home', line: '/home is 95% full' };
  const kinds = { disk: makeStubKind([[fault], [fault], [fault], [fault], [fault]]) };
  const checks = [{ id: 'disk-main', kind: 'disk' }];

  for (const minute of ['00', '01', '02', '03', '04']) {
    await ctx.runAt(`2026-11-17T08:${minute}:00Z`, checks, kinds, ctx.notifier);
  }

  expect(ctx.notifier.sent).toHaveLength(1);
});

test('it sends nothing and saves only lastRun on a run where nothing changed', async () => {
  const ctx = setupTest();
  const fault = { key: '/home', line: '/home is 95% full' };
  const checks = [{ id: 'disk-main', kind: 'disk' }];
  const kinds = { disk: makeStubKind([[fault], [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);

  const before = ctx.file.state;

  const result = await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect([result.sent, ctx.notifier.sent.length, ctx.file.state]).toStrictEqual([
    0,
    1,
    { faults: before.faults, lastRun: { 'disk-main': '2026-11-17T08:01:00.000Z' } },
  ]);
});

test('it writes nothing on a run with no due check and nothing owed', async () => {
  const ctx = setupTest();
  const checks = [{ id: 'disk-main', kind: 'disk', everyMin: 15 }];
  const kinds = { disk: makeStubKind([[]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);

  const saves = ctx.file.saves;

  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect(ctx.file.saves).toBe(saves);
});

test('it resends a failed send once on the next run under the same idempotency key', async () => {
  const ctx = setupTest();

  const notifier = buildStubNotifier([
    { kind: 'failed', reason: 'atc unreachable' },
    { kind: 'sent' },
  ]);

  const fault = { key: '/home', line: '/home is 95% full' };
  const checks = [{ id: 'disk-main', kind: 'disk' }];
  const kinds = { disk: makeStubKind([[fault], [fault], [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:02:00Z', checks, kinds, notifier);

  const [first, resend] = notifier.sent;

  expect([notifier.sent.length, resend]).toStrictEqual([2, first]);
});

test('it keeps a failed send owed in the file', async () => {
  const ctx = setupTest();
  const notifier = buildStubNotifier([{ kind: 'failed', reason: 'atc unreachable' }]);
  const checks = [{ id: 'disk-main', kind: 'disk' }];
  const kinds = { disk: makeStubKind([[{ key: '/home', line: '/home is 95% full' }]]) };

  const result = await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);

  expect([result.failedSends, ctx.file.state.faults['disk-main:/home']?.owed]).toStrictEqual([
    1,
    'open',
  ]);
});

test('it opens one cannot-run fault for a check that throws, and clears none of its faults', async () => {
  const ctx = setupTest();
  const fault = { key: '/home', line: '/home is 95% full' };
  const checks = [{ id: 'disk-main', kind: 'disk' }];
  const kinds = { disk: makeStubKind([[fault], new Error('df: not found')]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT disk-main:/home: /home is 95% full',
    'FAULT disk-main: cannot run: df: not found',
  ]);
});

test('it clears the cannot-run fault on the check next good run', async () => {
  const ctx = setupTest();
  const fault = { key: '/home', line: '/home is 95% full' };
  const checks = [{ id: 'disk-main', kind: 'disk' }];
  const kinds = { disk: makeStubKind([[fault], new Error('df: not found'), [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:02:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT disk-main:/home: /home is 95% full',
    'FAULT disk-main: cannot run: df: not found',
    'RECOVERED disk-main (failing since 2026-11-17T08:01:00.000Z): cannot run: df: not found',
  ]);
});

test('it opens a cannot-run fault for a check that runs past its timeout', async () => {
  const ctx = setupTest();
  const checks = [{ id: 'slow', kind: 'hang' }];
  const kinds = { hang: () => new Promise<never>(() => {}) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT slow: cannot run: timed out after 1000 ms',
  ]);
});

test('it opens a cannot-run fault for a check whose kind is not in the table', async () => {
  const ctx = setupTest();

  await ctx.runAt('2026-11-17T08:00:00Z', [{ id: 'web', kind: 'htp' }], {}, ctx.notifier);

  expect(ctx.notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT web: cannot run: no kind named htp',
  ]);
});

test('it runs a check with everyMin 15 once over 15 one-minute runs', async () => {
  const ctx = setupTest();
  const kind = makeStubKind([[]]);
  const checks = [{ id: 'disk-main', kind: 'disk', everyMin: 15 }];

  for (let minute = 0; minute < 15; minute += 1) {
    await ctx.runAt(
      `2026-11-17T08:${String(minute).padStart(2, '0')}:00Z`,
      checks,
      { disk: kind },
      ctx.notifier,
    );
  }

  expect(kind).toHaveBeenCalledTimes(1);
});

test('it runs a check with everyMin 15 again on a timer that fires 3 seconds early', async () => {
  const ctx = setupTest();
  const kind = makeStubKind([[], []]);
  const checks = [{ id: 'disk-main', kind: 'disk', everyMin: 15 }];

  await ctx.runAt('2026-11-17T08:00:00Z', checks, { disk: kind }, ctx.notifier);
  await ctx.runAt('2026-11-17T08:14:57Z', checks, { disk: kind }, ctx.notifier);

  expect(kind).toHaveBeenCalledTimes(2);
});

test('it clears no fault of a check that was not due', async () => {
  const ctx = setupTest();
  const checks = [{ id: 'disk-main', kind: 'disk', everyMin: 15 }];
  const kinds = { disk: makeStubKind([[{ key: '/home', line: '/home is 95% full' }]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, ctx.notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, ctx.notifier);

  expect(ctx.notifier.sent).toHaveLength(1);
});

test('it sends one recovery for each fault stu holds open for a check dropped from the config', async () => {
  const ctx = setupTest();

  const kinds = {
    disk: makeStubKind([
      [
        { key: '/home', line: '/home is 95% full' },
        { key: '/var', line: '/var is 97% full' },
      ],
    ]),
    tcp: makeStubKind([[], []]),
  };

  const tunnel = { id: 'tunnel', kind: 'tcp' };

  await ctx.runAt(
    '2026-11-17T08:00:00Z',
    [{ id: 'disk-main', kind: 'disk' }, tunnel],
    kinds,
    ctx.notifier,
  );

  await ctx.runAt('2026-11-17T08:01:00Z', [tunnel], kinds, ctx.notifier);

  expect([ctx.notifier.sent.map((message) => message.text), ctx.file.state]).toStrictEqual([
    [
      'FAULT disk-main:/home: /home is 95% full',
      'FAULT disk-main:/var: /var is 97% full',
      'RECOVERED disk-main:/home (failing since 2026-11-17T08:00:00.000Z): /home is 95% full',
      'RECOVERED disk-main:/var (failing since 2026-11-17T08:00:00.000Z): /var is 97% full',
    ],
    { faults: {}, lastRun: { tunnel: '2026-11-17T08:01:00.000Z' } },
  ]);
});

test('it saves a new send key before the send that uses it when atc answers rekey', async () => {
  const ctx = setupTest();
  const keysOnFile: (string | null | undefined)[] = [];
  const answers: SendOutcome[] = [{ kind: 'rekey', reason: 'outcome_unknown' }, { kind: 'sent' }];
  const sent: OwedMessage[] = [];

  const notifier: Notifier = {
    send: (message) => {
      sent.push(message);
      keysOnFile.push(ctx.file.state.faults['tunnel:a:22']?.sendKey);

      return Promise.resolve(answers.shift() ?? { kind: 'sent' });
    },
  };

  const kinds = { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', [{ id: 'tunnel', kind: 'tcp' }], kinds, notifier);

  const [first, second] = sent;

  expect([keysOnFile, second?.idempotencyKey]).toStrictEqual([
    [first?.idempotencyKey, `${first?.idempotencyKey}:2`],
    `${first?.idempotencyKey}:2`,
  ]);
});

test('it keeps owing an open whose send failed when the fault clears, then sends the open and the recovery', async () => {
  const ctx = setupTest();
  const notifier = buildStubNotifier([{ kind: 'failed', reason: 'reply lost' }, { kind: 'sent' }]);
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[{ key: 'a:22', line: 'no answer from a:22' }], []]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);

  expect(notifier.sent.map((message) => message.text)).toStrictEqual([
    'FAULT tunnel:a:22: no answer from a:22',
    'FAULT tunnel:a:22: no answer from a:22',
    'RECOVERED tunnel:a:22 (failing since 2026-11-17T08:00:00.000Z): no answer from a:22',
  ]);
});

test('it resends an owed recovery before it opens the fault that came back, under a new since', async () => {
  const ctx = setupTest();

  const notifier = buildStubNotifier([
    { kind: 'sent' },
    { kind: 'failed', reason: 'reply lost' },
    { kind: 'sent' },
  ]);

  const fault = { key: 'a:22', line: 'no answer from a:22' };
  const checks = [{ id: 'tunnel', kind: 'tcp' }];
  const kinds = { tcp: makeStubKind([[fault], [], [fault]]) };

  await ctx.runAt('2026-11-17T08:00:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:01:00Z', checks, kinds, notifier);
  await ctx.runAt('2026-11-17T08:02:00Z', checks, kinds, notifier);

  const [open, recovery, recoveryResend, reopen] = notifier.sent;

  expect([
    notifier.sent.length,
    recoveryResend,
    reopen?.text,
    reopen?.idempotencyKey === open?.idempotencyKey,
  ]).toStrictEqual([4, recovery, 'FAULT tunnel:a:22: no answer from a:22', false]);
});
