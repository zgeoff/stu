import { expect, test } from 'bun:test';
import { buildStubSecrets } from './build-stub-secrets.ts';

test('it answers a reference it holds with its value', () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/credential': 'test-secret-a' });
  const answer = stub.secrets.readSecret('op://vault-test/item-a/credential');

  expect(answer).resolves.toStrictEqual({ kind: 'read', value: 'test-secret-a' });
});

test('it answers a reference it does not hold as unread', () => {
  const stub = buildStubSecrets({});
  const answer = stub.secrets.readSecret('op://vault-test/item-b/credential');

  expect(answer).resolves.toStrictEqual({
    kind: 'unread',
    reason: 'the stub holds no such secret',
  });
});

test('it records each reference it is asked for, repeats included', async () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/credential': 'test-secret-a' });

  await stub.secrets.readSecret('op://vault-test/item-a/credential');
  await stub.secrets.readSecret('op://vault-test/item-a/credential');

  expect(stub.reads).toStrictEqual([
    'op://vault-test/item-a/credential',
    'op://vault-test/item-a/credential',
  ]);
});
