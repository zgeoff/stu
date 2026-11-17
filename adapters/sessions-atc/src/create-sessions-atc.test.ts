import { expect, test } from 'bun:test';
import type { AtcAnswer } from '@stu/model';
import { createSessionsAtc } from './create-sessions-atc.ts';
import { buildMockSessionDescriptor } from './test-utils/build-mock-session-descriptor.ts';
import { buildStubAtcReader } from './test-utils/build-stub-atc-reader.ts';

test('it lists each session with its lifecycle and its last activity from /session/get', async () => {
  const sessions = createSessionsAtc(
    buildStubAtcReader(
      { sessions: [buildMockSessionDescriptor({ id: 's1-k9q1r', name: 'build-lane' })] },
      { 's1-k9q1r': { lastActivityAt: 1_794_900_000_000, prompt: null, pending: null } },
    ),
  );

  const listed = await sessions.listSessions();

  expect(listed).toStrictEqual([
    {
      id: 's1-k9q1r',
      name: 'build-lane',
      state: 'running',
      desired: 'run',
      harness: 'running',
      lastActivityAt: 1_794_900_000_000,
    },
  ]);
});

test('it rejects a list answer that is not a session list', () => {
  const sessions = createSessionsAtc(buildStubAtcReader({ fleet: [] }, {}));

  expect(sessions.listSessions()).rejects.toThrow();
});

test.each<[AtcAnswer, string]>([
  [
    { kind: 'refused', code: 'unknown_method', data: {} },
    'atc refused /session/list: unknown_method',
  ],
  [
    { kind: 'unreached', reason: 'atc gave no answer in 200 ms' },
    'atc read /session/list failed: atc gave no answer in 200 ms',
  ],
])('it rejects with the cause when atc gives %o', (answer, cause) => {
  const sessions = createSessionsAtc({ read: () => Promise.resolve(answer) });

  expect(sessions.listSessions()).rejects.toThrow(cause);
});
