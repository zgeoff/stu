import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStubOp } from './write-stub-op.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return {
    folder,
    runOp: async (binFolder: string, args: readonly string[], serviceAccountToken: string) => {
      const op = Bun.spawn([join(binFolder, 'op'), ...args], {
        env: { OP_SERVICE_ACCOUNT_TOKEN: serviceAccountToken },
        stdout: 'pipe',
      });

      const [code, stdout] = await Promise.all([op.exited, op.stdout.text()]);

      return { code, stdout };
    },
  };
}

test('it writes an op that prints the value of a reference it holds', async () => {
  const ctx = await setupTest();

  const binFolder = await writeStubOp(ctx.folder, {
    serviceAccountToken: 'ops-test-token',
    values: { 'op://vault-test/item-a/credential': "test-secret-'a'" },
  });

  const result = await ctx.runOp(
    binFolder,
    ['read', 'op://vault-test/item-a/credential'],
    'ops-test-token',
  );

  expect(result).toStrictEqual({ code: 0, stdout: "test-secret-'a'\n" });
});

test('it writes an op that exits 1 for a reference it does not hold', async () => {
  const ctx = await setupTest();

  const binFolder = await writeStubOp(ctx.folder, {
    serviceAccountToken: 'ops-test-token',
    values: {},
  });

  const result = await ctx.runOp(
    binFolder,
    ['read', 'op://vault-test/item-b/credential'],
    'ops-test-token',
  );

  expect(result).toStrictEqual({ code: 1, stdout: '' });
});

test('it writes an op that exits 1 for another service account token', async () => {
  const ctx = await setupTest();

  const binFolder = await writeStubOp(ctx.folder, {
    serviceAccountToken: 'ops-test-token',
    values: { 'op://vault-test/item-a/credential': 'test-secret-a' },
  });

  const result = await ctx.runOp(
    binFolder,
    ['read', 'op://vault-test/item-a/credential'],
    'ops-test-other',
  );

  expect(result).toStrictEqual({ code: 1, stdout: '' });
});
