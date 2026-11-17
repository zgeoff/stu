import { expect, test } from 'bun:test';
import { createSessionsAtc } from './create-sessions-atc.ts';
import { makeDeadSessionKind } from './make-dead-session-kind.ts';
import { buildMockSessionDescriptor } from './test-utils/build-mock-session-descriptor.ts';
import { buildStubAtcReader } from './test-utils/build-stub-atc-reader.ts';

test('it sees one fault keyed by the session id for a session atc wants running whose harness exited', async () => {
  const dead = buildMockSessionDescriptor({
    id: 's1-k9q1r',
    name: 'build-lane',
    state: 'exited',
    lifecycle: { desired: 'run', vm: 'none', harness: 'exited', attachment: 'detached' },
  });

  const parked = buildMockSessionDescriptor({
    id: 's2-m4x2p',
    name: 'parked',
    state: 'exited',
    lifecycle: { desired: 'stop', vm: 'none', harness: 'exited', attachment: 'detached' },
  });

  const live = buildMockSessionDescriptor({ id: 's3-p7t0w', name: 'live' });

  const reader = buildStubAtcReader(
    { sessions: [dead, parked, live] },
    {
      's1-k9q1r': { lastActivityAt: 1_794_900_000_000 },
      's2-m4x2p': { lastActivityAt: 1_794_900_000_000 },
      's3-p7t0w': { lastActivityAt: 1_794_900_000_000 },
    },
  );

  const kind = makeDeadSessionKind(createSessionsAtc(reader));

  const faults = await kind({});

  expect(faults).toStrictEqual([
    {
      key: 's1-k9q1r',
      line: 'session build-lane is dead: atc wants it running, and its harness exited',
    },
  ]);
});
