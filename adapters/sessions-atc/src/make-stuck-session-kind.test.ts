import { expect, test } from 'bun:test';
import { createFakeClock } from '@zgeoff/testing/clock';
import { createSessionsAtc } from './create-sessions-atc.ts';
import { makeStuckSessionKind } from './make-stuck-session-kind.ts';
import { buildMockSessionDescriptor } from './test-utils/build-mock-session-descriptor.ts';
import { buildStubAtcReader } from './test-utils/build-stub-atc-reader.ts';

test('it sees one fault keyed by the session id for a running session idle past stuckMin', async () => {
  const nowMs = 1_794_900_000_000;
  const idle = buildMockSessionDescriptor({ id: 's1-k9q1r', name: 'build-lane' });
  const busy = buildMockSessionDescriptor({ id: 's2-m4x2p', name: 'busy' });

  const waiting = buildMockSessionDescriptor({
    id: 's3-p7t0w',
    name: 'waiting',
    state: 'needs_you',
  });

  const reader = buildStubAtcReader(
    { sessions: [idle, busy, waiting] },
    {
      's1-k9q1r': { lastActivityAt: nowMs - 45 * 60_000 },
      's2-m4x2p': { lastActivityAt: nowMs - 5 * 60_000 },
      's3-p7t0w': { lastActivityAt: nowMs - 90 * 60_000 },
    },
  );

  const kind = makeStuckSessionKind(createSessionsAtc(reader), createFakeClock({ startMs: nowMs }));

  const faults = await kind({ stuckMin: 30 });

  expect(faults).toStrictEqual([
    { key: 's1-k9q1r', line: 'session build-lane is running with no activity for 45 min' },
  ]);
});

test('it throws on params without stuckMin', () => {
  const kind = makeStuckSessionKind(
    createSessionsAtc(buildStubAtcReader({ sessions: [] }, {})),
    createFakeClock({ startMs: 1_794_900_000_000 }),
  );

  expect(kind({})).rejects.toThrow();
});
