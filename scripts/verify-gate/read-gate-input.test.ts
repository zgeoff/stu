import { expect, test } from 'bun:test';
import { readGateInput } from './read-gate-input.ts';

test('it gates a pull request on its base branch and body', () => {
  const event = { pull_request: { body: 'the report', base: { ref: 'main' } } };

  expect(readGateInput(event)).toStrictEqual({ kind: 'gate', baseRef: 'main', body: 'the report' });
});

test('it gates a pull request with no body on an empty one', () => {
  const event = { pull_request: { body: null, base: { ref: 'main' } } };

  expect(readGateInput(event)).toStrictEqual({ kind: 'gate', baseRef: 'main', body: '' });
});

test('it refuses an event with no pull request', () => {
  expect(readGateInput({ ref: 'refs/heads/main' })).toStrictEqual({
    kind: 'refused',
    message: 'the event holds no pull request; run this on pull_request',
  });
});
