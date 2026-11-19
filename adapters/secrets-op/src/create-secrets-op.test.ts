import { expect, mock, test } from 'bun:test';
import type { ProgramResult, RunProgram } from '@stu/model';
import { createSecretsOp } from './create-secrets-op.ts';

function setupTest() {
  return {
    createSecrets: (run: RunProgram, serviceAccountToken: string | undefined) =>
      createSecretsOp({
        run,
        opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
        serviceAccountToken,
      }),
  };
}

test('it reads a reference with op read and the service account token, and trims the value', async () => {
  const ctx = setupTest();
  const run = mock<RunProgram>(() => Promise.resolve({ code: 0, stdout: 'test-secret-a\n' }));
  const secrets = ctx.createSecrets(run, 'ops-test-token');

  const answer = await secrets.readSecret('op://vault-test/item-a/credential');

  expect(answer).toStrictEqual({ kind: 'read', value: 'test-secret-a' });

  expect(run.mock.calls).toStrictEqual([
    [
      ['op', 'read', 'op://vault-test/item-a/credential'],
      {
        env: {
          PATH: '/usr/bin',
          HOME: '/tmp/stu-test',
          OP_SERVICE_ACCOUNT_TOKEN: 'ops-test-token',
        },
        timeoutMs: 30_000,
      },
    ],
  ]);
});

test.each<[string, ProgramResult, string]>([
  [
    'op read exits 1',
    { code: 1, stdout: 'op://vault-test/item-a/credential' },
    'op read failed (exit 1)',
  ],
  ['op read exits 0 with an empty value', { code: 0, stdout: '\n' }, 'op read failed (exit 0)'],
])('it answers unread without the reference when %s', (_case, result, reason) => {
  const ctx = setupTest();
  const secrets = ctx.createSecrets(() => Promise.resolve(result), 'ops-test-token');
  const answer = secrets.readSecret('op://vault-test/item-a/credential');

  expect(answer).resolves.toStrictEqual({ kind: 'unread', reason });
});

test('it answers unread when op cannot start', () => {
  const ctx = setupTest();

  const secrets = ctx.createSecrets(
    () => Promise.reject(new Error('Executable not found in $PATH: "op"')),
    'ops-test-token',
  );

  const answer = secrets.readSecret('op://vault-test/item-a/credential');

  expect(answer).resolves.toStrictEqual({ kind: 'unread', reason: 'op could not start' });
});

test('it answers unread and runs no op when the watcher has no service account token', async () => {
  const ctx = setupTest();
  const run = mock<RunProgram>(() => Promise.resolve({ code: 0, stdout: 'test-secret-a\n' }));
  const secrets = ctx.createSecrets(run, undefined);

  const answer = await secrets.readSecret('op://vault-test/item-a/credential');

  expect(answer).toStrictEqual({ kind: 'unread', reason: 'OP_SERVICE_ACCOUNT_TOKEN is unset' });
  expect(run.mock.calls).toStrictEqual([]);
});
