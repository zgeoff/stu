import { expect, test } from 'bun:test';
import { z } from 'zod';
import { parseAtcBody } from './parse-atc-body.ts';

test('it parses the body of an answered call', () => {
  const answer = { kind: 'answered' as const, body: { sessions: [], extra: 1 } };
  const schema = z.object({ sessions: z.array(z.string()) });

  expect(parseAtcBody('/session/list', answer, schema)).toStrictEqual({ sessions: [] });
});

test('it rejects an answered body the schema refuses', () => {
  const answer = { kind: 'answered' as const, body: { fleet: [] } };
  const schema = z.object({ sessions: z.array(z.string()) });

  expect(() => parseAtcBody('/session/list', answer, schema)).toThrow();
});

test('it throws with the code when atc refuses the call', () => {
  const answer = { kind: 'refused' as const, code: 'no_such_session', data: {} };

  expect(() => parseAtcBody('/session/get', answer, z.object({}))).toThrowWithMessage(
    Error,
    'atc refused /session/get: no_such_session',
  );
});

test('it throws with the reason when no daemon answers', () => {
  const answer = { kind: 'unreached' as const, reason: 'atc gave no answer in 200 ms' };

  expect(() => parseAtcBody('/session/get', answer, z.object({}))).toThrowWithMessage(
    Error,
    'atc call /session/get failed: atc gave no answer in 200 ms',
  );
});
