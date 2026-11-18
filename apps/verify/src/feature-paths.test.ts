import { expect, test } from 'bun:test';
import { isGlobMatch } from '@wringer/core';
import { featurePaths, ignoredPaths, sharedPaths } from './feature-paths.ts';

test.each([
  'apps/watch/src/main.ts',
  'apps/watch/package.json',
  'modules/faults/src/run-watch.ts',
  'libs/model/src/types.ts',
  'adapters/notifier-atc/src/create-atc-notifier.ts',
  'adapters/probe-net/src/probe.ts',
  'adapters/state-file/package.json',
])('it maps %s to fault-messages, and never ignores it', (path) => {
  expect([
    isGlobMatch(path, featurePaths['fault-messages']),
    isGlobMatch(path, ignoredPaths),
  ]).toStrictEqual([true, false]);
});

test.each([
  'docs/README.md',
  'apps/watch/README.md',
  'apps/watch/src/main.test.ts',
  'adapters/notifier-atc/src/test-utils/start-stub-atc.ts',
  'adapters/host-linux/src/index.ts',
  'adapters/sessions-atc/src/index.ts',
  'apps/watch/systemd/stu-watch.service',
  'package.json',
  'bun.lock',
  '.github/workflows/verify.yml',
  'scripts/verify-gate/run-verify-gate.ts',
])('it ignores %s', (path) => {
  expect(isGlobMatch(path, ignoredPaths)).toBeTrue();
});

test('it shares a change to the verify app with every feature', () => {
  expect(isGlobMatch('apps/verify/src/create-verify-registry.ts', sharedPaths)).toBeTrue();
});

test.each(['apps/watch/new-file.ts', 'adapters/new-adapter/src/index.ts'])(
  'it leaves %s unmapped',
  (path) => {
    expect([
      isGlobMatch(path, featurePaths['fault-messages']),
      isGlobMatch(path, sharedPaths),
      isGlobMatch(path, ignoredPaths),
    ]).toStrictEqual([false, false, false]);
  },
);
