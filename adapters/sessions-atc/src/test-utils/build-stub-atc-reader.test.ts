import { expect, test } from 'bun:test';
import { buildStubAtcReader } from './build-stub-atc-reader.ts';

test('it answers /session/list with the list answer', async () => {
  const reader = buildStubAtcReader({ sessions: [] }, {});

  const answer = await reader.read('/session/list', {});

  expect(answer).toStrictEqual({ kind: 'answered', body: { sessions: [] } });
});

test('it answers /session/get with the answer recorded for the session', async () => {
  const reader = buildStubAtcReader({ sessions: [] }, { 's1-k9q1r': { lastActivityAt: 5 } });

  const answer = await reader.read('/session/get', { session: 's1-k9q1r' });

  expect(answer).toStrictEqual({ kind: 'answered', body: { lastActivityAt: 5 } });
});

test('it rejects a read with no recorded answer', () => {
  const reader = buildStubAtcReader({ sessions: [] }, {});

  expect(reader.read('/session/get', { session: 's9' })).rejects.toThrow('no recorded answer');
});
