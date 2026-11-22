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

test('it masks a read value that a kind puts in a fault key or line', async () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/id': 'test-secret-id' });

  const quota = makeStubKind([
    [{ key: 'test-secret-id', line: 'Claude slot test-secret-id is over its limit' }],
  ]);

  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);

  const faults = await kinds['quota-anthropic']?.({ slots: [{ id: 'op://vault-test/item-a/id' }] });

  expect(faults).toStrictEqual([
    { key: '[secret at slots.0.id]', line: 'Claude slot [secret at slots.0.id] is over its limit' },
  ]);
});

test('it keeps the faults of two read values apart once it masks them', async () => {
  const stub = buildStubSecrets({
    'op://vault-test/item-a/id': 'test-secret-a',
    'op://vault-test/item-b/id': 'test-secret-b',
  });

  const quota = makeStubKind([
    [
      { key: 'test-secret-a', line: 'slot test-secret-a is over' },
      { key: 'test-secret-b', line: 'slot test-secret-b is over' },
    ],
  ]);

  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);

  const faults = await kinds['quota-anthropic']?.({
    slots: [{ id: 'op://vault-test/item-a/id' }, { id: 'op://vault-test/item-b/id' }],
  });

  expect(faults).toStrictEqual([
    { key: '[secret at slots.0.id]', line: 'slot [secret at slots.0.id] is over' },
    { key: '[secret at slots.1.id]', line: 'slot [secret at slots.1.id] is over' },
  ]);
});

test('it masks a read value in the message a kind throws', () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/id': 'test-secret-id' });
  const quota = makeStubKind([new Error('slot test-secret-id: the messages API answered 401')]);
  const kinds = buildSecretKinds({ 'quota-anthropic': quota }, stub.secrets);
  const run = kinds['quota-anthropic']?.({ slots: [{ id: 'op://vault-test/item-a/id' }] });

  expect(run).rejects.toThrowWithMessage(
    Error,
    'slot [secret at slots.0.id]: the messages API answered 401',
  );
});

test('it masks a read value that a kind throws as a bare string', () => {
  const stub = buildStubSecrets({ 'op://vault-test/item-a/token': 'test-secret-token' });

  const kinds = buildSecretKinds(
    {
      // a value that is not an Error, as a kind built on a library that throws strings could give
      'alerts-prometheus': (params) => {
        const reason: unknown = `bad token ${String(params['token'])}`;

        return Promise.reject(reason);
      },
    },
    stub.secrets,
  );

  const run = kinds['alerts-prometheus']?.({ token: 'op://vault-test/item-a/token' });

  expect(run).rejects.toThrowWithMessage(Error, 'bad token [secret at token]');
});
