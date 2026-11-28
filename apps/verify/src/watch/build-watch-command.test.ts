import { expect, test } from 'bun:test';
import { buildWatchCommand } from './build-watch-command.ts';

test('it runs the watcher with only PATH and the run home in its environment', () => {
  const run = {
    root: '/tmp/stu-verify-pear',
    home: '/tmp/stu-verify-pear/home',
    runtime: '/tmp/stu-verify-pear/run',
    socket: '/tmp/stu-verify-pear/run/atc-daemon.sock',
    session: 's1-pear',
    probePort: '40123',
  };

  const program = {
    path: '/usr/local/bin:/usr/bin',
    main: '/tmp/stu-test/apps/watch/src/main.ts',
    configPath: '/tmp/stu-verify-pear/stu-watch.config.json',
  };

  expect(buildWatchCommand(run, program)).toStrictEqual([
    'env',
    '-i',
    'PATH=/usr/local/bin:/usr/bin',
    'HOME=/tmp/stu-verify-pear/home',
    'XDG_RUNTIME_DIR=/tmp/stu-verify-pear/run',
    'bun',
    '/tmp/stu-test/apps/watch/src/main.ts',
    '/tmp/stu-verify-pear/stu-watch.config.json',
  ]);
});
