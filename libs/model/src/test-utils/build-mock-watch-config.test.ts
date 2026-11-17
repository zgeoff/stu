import { expect, test } from 'bun:test';
import { WATCH_CONFIG_SCHEMA } from '../watch-config-schema.ts';
import { buildMockWatchConfig } from './build-mock-watch-config.ts';

test('it builds a config that the watch config schema accepts', () => {
  const config = buildMockWatchConfig();

  expect(WATCH_CONFIG_SCHEMA.safeParse(config).success).toBeTrue();
});

test('it takes the overrides it is given', () => {
  const config = buildMockWatchConfig({ checks: [] });

  expect(config.checks).toStrictEqual([]);
});
