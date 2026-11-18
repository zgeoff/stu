import { expect, mock, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from '@stu/host-linux';
import { createProbeNet } from '@stu/probe-net';
import { startStubHTTP } from '@stu/probe-net/test-utils/start-stub-http';
import { startStubTCP } from '@stu/probe-net/test-utils/start-stub-tcp';
import { buildKinds } from './build-kinds.ts';
import { readWatchConfig } from './read-watch-config.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const procRoot = join(folder, 'proc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(join(procRoot, 'pressure'), { recursive: true });

  return {
    procRoot,
    kinds: buildKinds({
      host: createHostLinux({ procRoot }),
      net: createProbeNet(),

      // the sessions port's real client needs an atc daemon that serves the session reads
      sessions: { listSessions: mock(() => Promise.resolve([])) },
      readNowMs: () => 1_794_900_000_000,
    }),
  };
}

// The example's hosts are placeholders, so the net checks go to local servers instead, which keeps
// the test off the network; every other param is the example's.
test('it runs every check of the example config without a throw', async () => {
  const ctx = await setupTest();

  await writeFile(
    join(ctx.procRoot, 'meminfo'),
    'MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\n',
  );

  await writeFile(
    join(ctx.procRoot, 'pressure', 'memory'),
    'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
  );

  const config = await readWatchConfig(
    join(import.meta.dir, '..', 'stu-watch.config.example.json'),
  );

  const tcp = await startStubTCP();

  onTestFinished(() => tcp.stop());

  const http = await startStubHTTP(200);

  onTestFinished(() => http.stop());

  const localTargets: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    tcp: { host: '127.0.0.1', port: tcp.port },
    http: { url: `http://127.0.0.1:${http.port}/health` },
  };

  const runs = Promise.all(
    config.checks.map((check) => {
      const { id: _id, kind, everyMin: _everyMin, ...params } = check;

      return (
        ctx.kinds[kind]?.({ ...params, ...localTargets[kind] }) ??
        Promise.reject(new Error(`no kind named ${kind}`))
      );
    }),
  );

  expect(runs).resolves.toSatisfyAll(Array.isArray);
});
