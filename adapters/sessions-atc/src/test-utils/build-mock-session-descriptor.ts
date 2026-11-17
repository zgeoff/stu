import type { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import type { z } from 'zod';

type WireSessionDescriptor = z.input<typeof SESSION_DESCRIPTOR_SCHEMA>;

// One session as atc's /session/list answers it, with invented values.
export function buildMockSessionDescriptor(
  overrides: Partial<WireSessionDescriptor> = {},
): WireSessionDescriptor {
  return {
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
    ...overrides,
  };
}
