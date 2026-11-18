import { expect, test } from 'bun:test';
import type { SendOutcome } from '@stu/model';
import { pickSendStep } from './pick-send-step.ts';
import type { SendStep } from './pick-send-step.ts';

test('it moves a fault whose open atc took to open, with no send key held', () => {
  const opening = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:k1',
      },
    },
    lastRun: {},
  };

  const step = pickSendStep(opening, 'tunnel:a:22', { kind: 'sent' }, 2);

  expect(step).toStrictEqual({
    kind: 'sent',
    state: {
      faults: {
        'tunnel:a:22': {
          check: 'tunnel',
          line: 'no answer from a:22',
          since: '2026-11-17T08:00:00.000Z',
          owed: null,
          sendKey: null,
        },
      },
      lastRun: {},
    },
  });
});

test('it drops a fault whose recovery atc took', () => {
  const clearing = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'clear' as const,
        sendKey: 'stu-watch:k1',
      },
    },
    lastRun: {},
  };

  const step = pickSendStep(clearing, 'tunnel:a:22', { kind: 'sent' }, 2);

  expect(step).toStrictEqual({ kind: 'sent', state: { faults: {}, lastRun: {} } });
});

test.each<[SendOutcome, number, SendStep['kind']]>([
  [{ kind: 'failed', reason: 'atc send failed: timed out' }, 2, 'failed'],
  [{ kind: 'failed', reason: 'atc send failed: timed out' }, 1, 'failed'],
  [{ kind: 'rekey', reason: 'outcome_unknown' }, 2, 'resend'],
  [{ kind: 'rekey', reason: 'outcome_unknown' }, 1, 'gave-up'],
])('it answers %o with %d tries left as %s', (outcome, triesLeft, kind) => {
  const opening = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:k1',
      },
    },
    lastRun: {},
  };

  const step = pickSendStep(opening, 'tunnel:a:22', outcome, triesLeft);

  expect(step.kind).toBe(kind);
});

test('it keeps the send key of a send that failed, and moves nothing', () => {
  const opening = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:k1',
      },
    },
    lastRun: {},
  };

  const step = pickSendStep(opening, 'tunnel:a:22', { kind: 'failed', reason: 'timed out' }, 2);

  expect(step).toStrictEqual({ kind: 'failed', reason: 'timed out' });
});

test('it moves the fault to its next send key on a rekey, with or without a try left', () => {
  const opening = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:k1',
      },
    },
    lastRun: {},
  };

  const rekeyed = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: 'open' as const,
        sendKey: 'stu-watch:k1:2',
      },
    },
    lastRun: {},
  };

  const outcome = { kind: 'rekey', reason: 'outcome_unknown' } as const;
  const resend = pickSendStep(opening, 'tunnel:a:22', outcome, 2);
  const gaveUp = pickSendStep(opening, 'tunnel:a:22', outcome, 1);

  expect(resend).toStrictEqual({ kind: 'resend', state: rekeyed });
  expect(gaveUp).toStrictEqual({ kind: 'gave-up', state: rekeyed, reason: 'outcome_unknown' });
});

test('it refuses a key that owes no send', () => {
  const open = {
    faults: {
      'tunnel:a:22': {
        check: 'tunnel',
        line: 'no answer from a:22',
        since: '2026-11-17T08:00:00.000Z',
        owed: null,
        sendKey: null,
      },
    },
    lastRun: {},
  };

  expect(() => pickSendStep(open, 'tunnel:a:22', { kind: 'sent' }, 2)).toThrow(
    'fault tunnel:a:22 owes no send',
  );
});
