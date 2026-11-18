import { expect, test } from 'bun:test';
import { WATCH_CONFIG_SCHEMA } from '@stu/model';
import { buildWatchConfig } from './build-watch-config.ts';

test('it builds a config with one tcp check on the probe port, sent to the session', () => {
  expect(buildWatchConfig('s1-pear', 40_123)).toStrictEqual({
    atc: { session: 's1-pear' },
    statePath: 'stu-watch.reported.json',
    checks: [{ id: 'verify-port', kind: 'tcp', host: '127.0.0.1', port: 40_123 }],
  });
});

test('it builds a config the watcher accepts', () => {
  expect(WATCH_CONFIG_SCHEMA.safeParse(buildWatchConfig('s1-pear', 40_123)).success).toBeTrue();
});
