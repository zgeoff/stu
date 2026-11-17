import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { startStubTCP } from '@stu/probe-net/test-utils/start-stub-tcp';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const home = join(folder, 'home');
  const runtimeDir = join(folder, 'run');
  const stateDir = join(home, '.local', 'state', 'atc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(runtimeDir, { recursive: true });
  await mkdir(stateDir, { recursive: true });

  return {
    runtimeDir,
    stateDir,
    startAtc: async (socketDir: string) => {
      const atc = await startStubAtc(socketDir, {
        protocol: 14,
        unknownLost: [],
        unknownStored: [],
        dropFirstReply: [],
        refusedKeys: {},
        messageReadRefusal: null,
      });

      onTestFinished(() => atc.stop());

      return atc;
    },
    seed: buildSeeder({ folder, stateDir }),

    // the environment a systemd user unit gets: the manager's, with no ATC_* variable and no
    // XDG_* variable beyond XDG_RUNTIME_DIR
    runMain: async (args: readonly string[]) => {
      const watcher = Bun.spawn([process.execPath, join(import.meta.dir, 'main.ts'), ...args], {
        env: {
          HOME: home,
          LANG: 'C.UTF-8',
          LOGNAME: 'stu-test',
          USER: 'stu-test',
          SHELL: '/bin/sh',
          PATH: '/usr/bin:/bin',
          XDG_RUNTIME_DIR: runtimeDir,
          INVOCATION_ID: '0123456789abcdef0123456789abcdef',
          JOURNAL_STREAM: '8:4242',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [exitCode, stdout, stderr] = await Promise.all([
        watcher.exited,
        watcher.stdout.text(),
        watcher.stderr.text(),
      ]);

      return { exitCode, stdout, stderr };
    },
  };
}

test('it sends stu one message as stu-watch for a tcp check at a closed port, and nothing on the next run', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.runtimeDir);
  const listener = await startStubTCP();

  await listener.stop();

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'closed', kind: 'tcp', host: '127.0.0.1', port: listener.port }],
  });

  const first = await ctx.runMain([configPath]);
  const second = await ctx.runMain([configPath]);

  expect(first).toStrictEqual({
    exitCode: 0,
    stdout: 'stu-watch: sent 1, failed 0\n',
    stderr: '',
  });

  expect(second).toStrictEqual({ exitCode: 0, stdout: '', stderr: '' });

  expect(atc.hellos).toStrictEqual([
    { client: 'stu-watch/0.1.0', protocol: 14, auth: { scheme: 'none' } },
  ]);

  expect(atc.stored).toStrictEqual([
    {
      id: 'm-1',
      session: 's-stu',
      text: `FAULT closed:127.0.0.1:${listener.port}: no answer from 127.0.0.1:${listener.port}`,
      from: 'stu-watch',
      idempotencyKey: expect.stringMatching(/^stu-watch:[0-9a-f]{32}$/u),
    },
  ]);
});

test('it reaches a daemon that listens under its state folder through the daemon record', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.stateDir);

  await ctx.seed.daemonRecord({ socketPath: atc.socketPath });

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'broken', kind: 'no-such-kind' }],
  });

  const result = await ctx.runMain([configPath]);

  expect(result).toStrictEqual({
    exitCode: 0,
    stdout: 'stu-watch: sent 1, failed 0\n',
    stderr: '',
  });

  expect(atc.stored.map((message) => message.text)).toStrictEqual([
    'FAULT broken: cannot run: no kind named no-such-kind',
  ]);
});

test('it exits 1 and prints the cause when no atc daemon listens', async () => {
  const ctx = await setupTest();

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'broken', kind: 'no-such-kind' }],
  });

  const result = await ctx.runMain([configPath]);

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: 'stu-watch: sent 0, failed 1\n',
    stderr: `stu-watch: broken stays owed: atc send failed: no atc daemon listens at ${join(ctx.runtimeDir, 'atc-daemon.sock')}\n`,
  });
});

test('it exits 2 without a config path', async () => {
  const ctx = await setupTest();
  const result = await ctx.runMain([]);

  expect(result.exitCode).toBe(2);
});
