import { expect, test } from 'bun:test';
import { WATCH_CONFIG_SCHEMA } from '../watch-config-schema.ts';
import { buildMockWatchConfig } from './build-mock-watch-config.ts';

test('it builds a default watch config', () => {
  const config = buildMockWatchConfig();

  expect(config).toStrictEqual({
    atc: { session: 's-stu' },
    statePath: 'reported.json',
    checks: [{ id: 'tunnel', kind: 'tcp', host: 'tunnel-a.example', port: 2222 }],
  });
});

test('it builds a default that the watch config schema accepts', () => {
  const config = buildMockWatchConfig();

  expect(WATCH_CONFIG_SCHEMA.safeParse(config).success).toBeTrue();
});

test('it applies overrides on top of the defaults', () => {
  const config = buildMockWatchConfig({ checks: [] });

  expect(config).toStrictEqual({
    atc: { session: 's-stu' },
    statePath: 'reported.json',
    checks: [],
  });
});
