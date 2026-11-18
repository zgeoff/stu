import { expect, test } from 'bun:test';
import { makeStubKind } from './make-stub-kind.ts';

test('it gives each fault answer in turn', async () => {
  const kind = makeStubKind([[{ key: 'k', line: 'down' }], []]);

  await kind({});

  const second = await kind({});

  expect(second).toStrictEqual([]);
});

test('it rejects with the error answer', () => {
  const kind = makeStubKind([new Error('cannot look')]);

  expect(kind({})).rejects.toThrow('cannot look');
});

test('it throws once its answers run out', () => {
  const kind = makeStubKind([]);

  expect(kind({})).rejects.toThrow('ran out');
});
