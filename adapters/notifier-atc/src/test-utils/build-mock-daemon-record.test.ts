import { expect, test } from 'bun:test';
import { buildMockDaemonRecord } from './build-mock-daemon-record.ts';

test('it builds a default daemon record', () => {
  const record = buildMockDaemonRecord();

  expect(record).toStrictEqual({
    pid: 4242,
    socketPath: '/tmp/stu-test/run/atc-daemon.sock',
    protocol: 15,
  });
});

test('it applies overrides on top of the defaults', () => {
  const record = buildMockDaemonRecord({ socketPath: '/tmp/stu-test/state/atc-daemon.sock' });

  expect(record).toStrictEqual({
    pid: 4242,
    socketPath: '/tmp/stu-test/state/atc-daemon.sock',
    protocol: 15,
  });
});
