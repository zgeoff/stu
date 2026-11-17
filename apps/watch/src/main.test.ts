import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { startStubTCP } from '@stu/probe-net/test-utils/start-stub-tcp';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const atc = await startStubAtc(folder, {
    protocol: 14,
    unknownLost: [],
    unknownStored: [],
    dropFirstReply: [],
  });

  onTestFinished(() => atc.stop());

  return {
    folder,
    atc,
    runMain: async (args: readonly string[]) => {
      const watcher = Bun.spawn(['bun', join(import.meta.dir, 'main.ts'), ...args], {
        env: { ...process.env, XDG_RUNTIME_DIR: folder },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [exitCode, stdout] = await Promise.all([watcher.exited, watcher.stdout.text()]);

      return { exitCode, stdout };
    },
  };
}

test('it sends stu one message as stu-watch for a tcp check at a closed port, and nothing on the next run', async () => {
  const ctx = await setupTest();
  const listener = await startStubTCP();

  await listener.stop();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      atc: { session: 's-stu' },
      statePath: 'reported.json',
      checks: [{ id: 'closed', kind: 'tcp', host: '127.0.0.1', port: listener.port }],
    }),
  );

  const first = await ctx.runMain([configPath]);
  const second = await ctx.runMain([configPath]);

  expect([first, second, ctx.atc.hellos, ctx.atc.stored]).toStrictEqual([
    { exitCode: 0, stdout: 'stu-watch: sent 1, failed 0\n' },
    { exitCode: 0, stdout: '' },
    [{ client: 'stu-watch/0.1.0', protocol: 14, auth: { scheme: 'none' } }],
    [
      {
        id: 'm-1',
        session: 's-stu',
        text: `FAULT closed:127.0.0.1:${listener.port}: no answer from 127.0.0.1:${listener.port}`,
        from: 'stu-watch',
        idempotencyKey: expect.stringMatching(/^stu-watch:[0-9a-f]{32}$/u),
      },
    ],
  ]);
});

test('it exits 1 when a send fails', async () => {
  const ctx = await setupTest();

  await ctx.atc.stop();

  const configPath = join(ctx.folder, 'stu-watch.config.json');

  await writeFile(
    configPath,
    JSON.stringify({
      atc: { session: 's-stu' },
      statePath: 'reported.json',
      checks: [{ id: 'broken', kind: 'no-such-kind' }],
    }),
  );

  const result = await ctx.runMain([configPath]);

  expect(result).toStrictEqual({ exitCode: 1, stdout: 'stu-watch: sent 0, failed 1\n' });
});

test('it exits 2 without a config path', async () => {
  const ctx = await setupTest();
  const result = await ctx.runMain([]);

  expect(result.exitCode).toBe(2);
});
