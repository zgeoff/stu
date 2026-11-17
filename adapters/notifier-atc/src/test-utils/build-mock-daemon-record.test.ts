import { expect, test } from 'bun:test';
import { buildMockDaemonRecord } from './build-mock-daemon-record.ts';

test('it builds a record with a pid, a socket path and a protocol', () => {
  const record = buildMockDaemonRecord();

  expect(record).toStrictEqual({
    pid: 4242,
    socketPath: '/tmp/stu-test/run/atc-daemon.sock',
    protocol: 14,
  });
});

test('it takes the overrides it is given', () => {
  const record = buildMockDaemonRecord({ socketPath: '/tmp/stu-test/state/atc-daemon.sock' });

  expect(record.socketPath).toBe('/tmp/stu-test/state/atc-daemon.sock');
});
