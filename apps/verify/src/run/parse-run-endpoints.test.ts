import { expect, test } from 'bun:test';
import { parseRunEndpoints } from './parse-run-endpoints.ts';

test('it reads the run endpoints from a ready line and drops the event', () => {
  const line = {
    event: 'ready',
    root: '/tmp/stu-verify-pear',
    home: '/tmp/stu-verify-pear/home',
    runtime: '/tmp/stu-verify-pear/run',
    socket: '/tmp/stu-verify-pear/run/atc-daemon.sock',
    session: 's1-pear',
    probePort: '40123',
  };

  expect(parseRunEndpoints(line)).toStrictEqual({
    root: '/tmp/stu-verify-pear',
    home: '/tmp/stu-verify-pear/home',
    runtime: '/tmp/stu-verify-pear/run',
    socket: '/tmp/stu-verify-pear/run/atc-daemon.sock',
    session: 's1-pear',
    probePort: '40123',
  });
});

test.each(['', 'port', '40123a'])('it rejects the probe port %p', (probePort) => {
  const line = {
    root: '/tmp/stu-verify-pear',
    home: '/tmp/stu-verify-pear/home',
    runtime: '/tmp/stu-verify-pear/run',
    socket: '/tmp/stu-verify-pear/run/atc-daemon.sock',
    session: 's1-pear',
    probePort,
  };

  expect(() => parseRunEndpoints(line)).toThrow();
});

test('it rejects a line with no session', () => {
  const line = {
    root: '/tmp/stu-verify-pear',
    home: '/tmp/stu-verify-pear/home',
    runtime: '/tmp/stu-verify-pear/run',
    socket: '/tmp/stu-verify-pear/run/atc-daemon.sock',
    probePort: '40123',
  };

  expect(() => parseRunEndpoints(line)).toThrow();
});
