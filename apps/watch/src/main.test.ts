import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStubGrafana } from '@stu/alerts-prometheus/test-utils/start-stub-grafana';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { startStubTCP } from '@stu/probe-net/test-utils/start-stub-tcp';
import { writeStubOp } from '@stu/secrets-op/test-utils/write-stub-op';
import { readReported } from '@stu/state-file';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const home = join(folder, 'home');
  const runtimeFolder = join(folder, 'run');
  const stateFolder = join(home, '.local', 'state', 'atc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(runtimeFolder, { recursive: true });
  await mkdir(stateFolder, { recursive: true });

  return {
    folder,
    runtimeFolder,
    stateFolder,
    startAtc: async (socketFolder: string) => {
      const atc = await startStubAtc(socketFolder, {
        major: 8,
        unknownLost: [],
        unknownStored: [],
        dropFirstReply: [],
        refusedKeys: {},
        messageReadRefusal: null,
        sendAnswer: null,
        sessions: [],
      });

      onTestFinished(() => atc.stop());

      return atc;
    },
    seed: buildSeeder({ folder, stateFolder }),

    // the environment a systemd user unit gets: the manager's, with no ATC_* variable and no
    // XDG_* variable beyond XDG_RUNTIME_DIR
    runMain: async (args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}) => {
      const watcher = Bun.spawn([process.execPath, join(import.meta.dir, 'main.ts'), ...args], {
        env: {
          HOME: home,
          LANG: 'C.UTF-8',
          LOGNAME: 'stu-test',
          USER: 'stu-test',
          SHELL: '/bin/sh',
          PATH: '/usr/bin:/bin',
          XDG_RUNTIME_DIR: runtimeFolder,
          INVOCATION_ID: '0123456789abcdef0123456789abcdef',
          JOURNAL_STREAM: '8:4242',
          ...extraEnv,
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

test('it sends stu one message as stu-watch for a tcp check at a closed port', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.runtimeFolder);

  const listener = startStubTCP();

  await listener.stop();

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'closed', kind: 'tcp', host: '127.0.0.1', port: listener.port }],
  });

  const run = await ctx.runMain([configPath]);

  expect(run).toStrictEqual({
    exitCode: 0,
    stdout: 'stu-watch: sent 1, failed 0\n',
    stderr: '',
  });

  expect(atc.hellos).toStrictEqual([
    { client: 'stu-watch/0.1.0', protocol: 15, major: 8, auth: { scheme: 'none' } },
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

test('it sends nothing on the next run while the closed port stays closed', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.runtimeFolder);

  const listener = startStubTCP();

  await listener.stop();

  const configPath = await ctx.seed.watchConfig({
    checks: [{ id: 'closed', kind: 'tcp', host: '127.0.0.1', port: listener.port }],
  });

  await ctx.runMain([configPath]);

  const next = await ctx.runMain([configPath]);

  expect(next).toStrictEqual({ exitCode: 0, stdout: '', stderr: '' });
  expect(atc.stored).toHaveLength(1);
});

test('it reaches a daemon that listens under its state folder through the daemon record', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.stateFolder);

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
    stderr: `stu-watch: broken stays owed: atc send failed: no atc daemon answers at ${join(ctx.runtimeFolder, 'atc-daemon.sock')}\n`,
  });
});

test('it exits 2 without a config path', async () => {
  const ctx = await setupTest();
  const result = await ctx.runMain([]);

  expect(result.exitCode).toBe(2);
});

test('it reads each op:// reference with op, and no secret reaches a message, the reported file or the output', async () => {
  const ctx = await setupTest();
  const atc = await ctx.startAtc(ctx.runtimeFolder);

  const binFolder = await writeStubOp(ctx.folder, {
    serviceAccountToken: 'test-op-service-token',
    values: { 'op://vault-test/item-grafana/credential': 'glsa_test_fake_secret' },
  });

  const grafana = startStubGrafana({
    token: 'glsa_test_fake_secret',
    firing: [{ alertname: 'DiskFull', severity: 'critical' }],
  });

  const configPath = await ctx.seed.watchConfig({
    statePath: 'reported.json',
    checks: [
      {
        id: 'prometheus',
        kind: 'alerts-prometheus',
        grafanaURL: grafana.url,
        datasourceUID: 'prom-test',
        token: 'op://vault-test/item-grafana/credential',
      },
      {
        id: 'claude-quota',
        kind: 'quota-anthropic',
        sevenPct: 85,
        slots: [{ id: 'slot-a', token: 'op://vault-test/item-missing/credential' }],
      },
    ],
  });

  const run = await ctx.runMain([configPath], {
    PATH: `${binFolder}:/usr/bin:/bin`,
    OP_SERVICE_ACCOUNT_TOKEN: 'test-op-service-token',
  });

  const reported = await readReported(join(ctx.folder, 'reported.json'));

  const written = [JSON.stringify(atc.stored), JSON.stringify(reported), run.stdout, run.stderr];

  expect(atc.stored.map((message) => message.text)).toIncludeSameMembers([
    'FAULT prometheus:alertname="DiskFull",severity="critical": Prometheus alert DiskFull (critical) is firing',
    'FAULT claude-quota: cannot run: the secret at slots.0.token: op read failed (exit 1)',
  ]);

  expect(written).toSatisfyAll(
    (text: string) =>
      !text.includes('glsa_test_fake_secret') &&
      !text.includes('test-op-service-token') &&
      !text.includes('op://'),
  );
});
