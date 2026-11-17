import { expect, test } from 'bun:test';
import { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import { buildMockSessionDescriptor } from './build-mock-session-descriptor.ts';

test('it builds a descriptor that atc session schema accepts', () => {
  const descriptor = buildMockSessionDescriptor();

  expect(SESSION_DESCRIPTOR_SCHEMA.safeParse(descriptor).success).toBeTrue();
});

test('it takes the overrides it is given', () => {
  const descriptor = buildMockSessionDescriptor({ id: 's2-x', state: 'exited' });

  expect([descriptor.id, descriptor.state]).toStrictEqual(['s2-x', 'exited']);
});
