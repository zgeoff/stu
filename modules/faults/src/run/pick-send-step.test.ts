import { expect, test } from 'bun:test';
import type { SendOutcome } from '@stu/model';
import { moveFault } from '../state/move-fault.ts';
import { pickSendStep } from './pick-send-step.ts';
import type { SendStep } from './pick-send-step.ts';

function setupTest() {
  const key = 'tunnel:a:22';

  const opening = moveFault({ faults: {}, lastRun: {} }, key, {
    to: 'opening',
    check: 'tunnel',
    line: 'no answer from a:22',
    since: '2026-11-17T08:00:00.000Z',
  });

  return {
    key,

    // the file with the fault owing its open
    opening,

    // the file with the fault owing its recovery
    clearing: moveFault(moveFault(opening, key, { to: 'open' }), key, { to: 'clearing' }),
  };
}

test('it moves a fault whose open atc took to open, with no send key held', () => {
  const ctx = setupTest();
  const step = pickSendStep(ctx.opening, ctx.key, { kind: 'sent' }, 2);

  expect(step).toStrictEqual({
    kind: 'sent',
    state: moveFault(ctx.opening, ctx.key, { to: 'open' }),
  });
});

test('it drops a fault whose recovery atc took', () => {
  const ctx = setupTest();
  const step = pickSendStep(ctx.clearing, ctx.key, { kind: 'sent' }, 2);

  expect(step).toStrictEqual({ kind: 'sent', state: { faults: {}, lastRun: {} } });
});

test.each<[SendOutcome, number, SendStep['kind']]>([
  [{ kind: 'failed', reason: 'atc send failed: timed out' }, 2, 'failed'],
  [{ kind: 'failed', reason: 'atc send failed: timed out' }, 1, 'failed'],
  [{ kind: 'rekey', reason: 'outcome_unknown' }, 2, 'resend'],
  [{ kind: 'rekey', reason: 'outcome_unknown' }, 1, 'gave-up'],
])('it answers %o with %d tries left as %s', (outcome, triesLeft, kind) => {
  const ctx = setupTest();
  const step = pickSendStep(ctx.opening, ctx.key, outcome, triesLeft);

  expect(step.kind).toBe(kind);
});

test('it keeps the send key of a send that failed, and moves nothing', () => {
  const ctx = setupTest();
  const step = pickSendStep(ctx.opening, ctx.key, { kind: 'failed', reason: 'timed out' }, 2);

  expect(step).toStrictEqual({ kind: 'failed', reason: 'timed out' });
});

test('it moves the fault to its next send key on a rekey, with or without a try left', () => {
  const ctx = setupTest();
  const rekeyed = moveFault(ctx.opening, ctx.key, { to: 'rekeyed' });
  const outcome = { kind: 'rekey', reason: 'outcome_unknown' } as const;
  const resend = pickSendStep(ctx.opening, ctx.key, outcome, 2);
  const gaveUp = pickSendStep(ctx.opening, ctx.key, outcome, 1);

  expect(resend).toStrictEqual({ kind: 'resend', state: rekeyed });
  expect(gaveUp).toStrictEqual({ kind: 'gave-up', state: rekeyed, reason: 'outcome_unknown' });
});

test('it refuses a key that owes no send', () => {
  const ctx = setupTest();
  const open = moveFault(ctx.opening, ctx.key, { to: 'open' });

  expect(() => pickSendStep(open, ctx.key, { kind: 'sent' }, 2)).toThrow(
    `fault ${ctx.key} owes no send`,
  );
});
