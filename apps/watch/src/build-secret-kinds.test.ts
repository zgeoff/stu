import { expect, test } from 'bun:test';
import { makeStubKind } from '@stu/faults/test-utils/make-stub-kind';
import { buildStubSecrets } from '@stu/model/test-utils/build-stub-secrets';
import { buildSecretKinds } from './build-secret-kinds.ts';

test('it gives the kind every op:// reference read, in a nested object and inside an array', async () => {
  const quota = makeStubKind([[]]);

  const stub = buildStubSecrets({
    'op://vault-test/item-a/credential': 'test-secret-a',
    'op://vault-test/item-b/credential': 'test-secret-b',
  });

  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);

  await kinds['quota-anthropic']?.({
    sevenPct: 85,
    auth: { token: 'op://vault-test/item-a/credential' },
    slots: [
      { id: 'slot-a', token: 'op://vault-test/item-a/credential' },
      { id: 'slot-b', token: 'op://vault-test/item-b/credential' },
    ],
  });

  expect(quota.mock.calls).toStrictEqual([
    [
      {
        sevenPct: 85,
        auth: { token: 'test-secret-a' },
        slots: [
          { id: 'slot-a', token: 'test-secret-a' },
          { id: 'slot-b', token: 'test-secret-b' },
        ],
      },
    ],
  ]);
});

test('it reads a reference that two kinds share once', async () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/credential': 'test-secret-a' });

  const kinds = buildSecretKinds(
    { 'alerts-prometheus': makeStubKind([[]]), 'alerts-axiom': makeStubKind([[]]) },
    stub.secrets,
  );

  await Promise.all([
    kinds['alerts-prometheus']?.({ token: 'op://vault-test/item-a/credential' }),
    kinds['alerts-axiom']?.({ token: 'op://vault-test/item-a/credential' }),
  ]);

  expect(stub.reads).toStrictEqual(['op://vault-test/item-a/credential']);
});

test('it gives the kind params that hold no reference as they are, and reads nothing', async () => {
  const tcp = makeStubKind([[]]);
  const stub = buildStubSecrets({});
  const kinds = buildSecretKinds({ tcp }, stub.secrets);

  await kinds['tcp']?.({
    host: 'tunnel-a.example',
    port: 2222,
    note: 'see op:// refs',
    tags: [null],
  });

  expect(stub.reads).toStrictEqual([]);

  expect(tcp.mock.calls).toStrictEqual([
    [{ host: 'tunnel-a.example', port: 2222, note: 'see op:// refs', tags: [null] }],
  ]);
});

test('it throws naming the path of the first unread reference, never the reference', () => {
  const quota = makeStubKind([[]]);
  const stub = buildStubSecrets({ 'op://vault-test/item-a/credential': 'test-secret-a' });
  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);

  const run = kinds['quota-anthropic']?.({
    slots: [
      { id: 'slot-a', token: 'op://vault-test/item-a/credential' },
      { id: 'slot-b', token: 'op://vault-test/item-missing-b/credential' },
      { id: 'slot-c', token: 'op://vault-test/item-missing-c/credential' },
    ],
  });

  expect(run).rejects.toThrowWithMessage(
    Error,
    'the secret at slots.1.token: the stub holds no such secret',
  );
});

test('it runs no kind whose params hold an unread reference', async () => {
  const quota = makeStubKind([[]]);
  const stub = buildStubSecrets({});
  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);

  await Promise.allSettled([
    kinds['quota-anthropic']?.({
      slots: [{ id: 'slot-a', token: 'op://vault-test/item-a/credential' }],
    }),
  ]);

  expect(quota.mock.calls).toStrictEqual([]);
});
