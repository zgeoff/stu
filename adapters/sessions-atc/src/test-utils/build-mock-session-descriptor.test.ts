import { expect, test } from 'bun:test';
import { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import { buildMockSessionDescriptor } from './build-mock-session-descriptor.ts';

test('it builds a default session descriptor', () => {
  const descriptor = buildMockSessionDescriptor();

  expect(descriptor).toStrictEqual({
    id: 's1-k9q1r',
    name: 'build-lane',
    cwd: '/tmp/stu-test/work',
    state: 'running',
    unread: false,
    lastMsg: 'reading the tests',
    agent: 'claude',
    pinned: false,
    lastAttachedAt: 1_794_900_000_000,
    repoRoot: '/tmp/stu-test/work',
    namedBy: 'user',
    createdAt: 1_794_800_000_000,
    kind: 'pty',
    alive: true,
    canEject: false,
    locator: { daemonID: 'daemon-test', targetID: 'local' },
    lifecycle: { desired: 'run', vm: 'none', harness: 'running', attachment: 'local' },
  });
});

test('it builds a default that the atc session schema accepts', () => {
  const descriptor = buildMockSessionDescriptor();

  expect(SESSION_DESCRIPTOR_SCHEMA.safeParse(descriptor).success).toBeTrue();
});

test('it applies overrides on top of the defaults', () => {
  const descriptor = buildMockSessionDescriptor({ id: 's2-x', state: 'exited' });

  expect(descriptor).toStrictEqual({
    id: 's2-x',
    name: 'build-lane',
    cwd: '/tmp/stu-test/work',
    state: 'exited',
    unread: false,
    lastMsg: 'reading the tests',
    agent: 'claude',
    pinned: false,
    lastAttachedAt: 1_794_900_000_000,
    repoRoot: '/tmp/stu-test/work',
    namedBy: 'user',
    createdAt: 1_794_800_000_000,
    kind: 'pty',
    alive: true,
    canEject: false,
    locator: { daemonID: 'daemon-test', targetID: 'local' },
    lifecycle: { desired: 'run', vm: 'none', harness: 'running', attachment: 'local' },
  });
});
