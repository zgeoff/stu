import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from '@stu/host-linux';
import type { FetchHTTP } from '@stu/model';
import { buildStubFetch } from '@stu/model/test-utils/build-stub-fetch';
import { createAtcClient } from '@stu/notifier-atc';
import { startStubAtc } from '@stu/notifier-atc/test-utils/start-stub-atc';
import type { StubAtcSession } from '@stu/notifier-atc/test-utils/start-stub-atc';
import { createProbeNet } from '@stu/probe-net';
import { startStubHTTP } from '@stu/probe-net/test-utils/start-stub-http';
import { startStubTCP } from '@stu/probe-net/test-utils/start-stub-tcp';
import { createSessionsAtc } from '@stu/sessions-atc';
import { buildMockSessionDescriptor } from '@stu/sessions-atc/test-utils/build-mock-session-descriptor';
import { buildKinds } from './build-kinds.ts';
import { readWatchConfig } from './read-watch-config.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const procRoot = join(folder, 'proc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(join(procRoot, 'pressure'), { recursive: true });

  return {
    procRoot,
    createKinds: async (
      sessions: readonly StubAtcSession[],

      // what the alert and quota kinds call in place of the network
      fetch: FetchHTTP,
    ) => {
      const atc = await startStubAtc(folder, {
        major: 7,
        unknownLost: [],
        unknownStored: [],
        dropFirstReply: [],
        refusedKeys: {},
        messageReadRefusal: null,
        sendAnswer: null,
        sessions,
      });

      onTestFinished(() => atc.stop());

      const client = createAtcClient({
        socketPath: atc.socketPath,
        client: 'stu-watch/0.1.0',
        timeoutMs: 1000,
      });

      return buildKinds({
        host: createHostLinux({ procRoot }),
        net: createProbeNet(),
        sessions: createSessionsAtc(client),
        readNowMs: () => 1_794_900_000_000,
        run: () => Promise.resolve({ code: 0, stdout: 'test-slot-token\n' }),
        fetch,
        sleepMs: () => new Promise(() => {}),
        opEnv: { PATH: '/usr/bin', HOME: '/tmp/stu-test' },
      });
    },
  };
}

// The example's hosts and secrets are placeholders, so the net checks go to local servers and the
// alert and quota kinds to a stub fetch, which keeps the test off the network; every other param is
// the example's.
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

  const usageHeaders = {
    'anthropic-ratelimit-unified-7d-utilization': '0.2',
  };

  const api = buildStubFetch({
    '/api/datasources/proxy/uid/PROMETHEUS_UID/api/v1/query': [
      Response.json({ status: 'success', data: { resultType: 'vector', result: [] } }),
    ],
    '/v2/monitors': [Response.json([])],
    '/v1/messages': Array.from({ length: 4 }, () => new Response(null, { headers: usageHeaders })),
  });

  const kinds = await ctx.createKinds(
    [
      {
        descriptor: buildMockSessionDescriptor({ id: 's1-k9q1r', name: 'build-lane' }),
        lastActivityAt: 1_794_900_000_000,
      },
    ],
    api.fetch,
  );

  const localTargets: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    tcp: { host: '127.0.0.1', port: tcp.port },
    http: { url: `http://127.0.0.1:${http.port}/health` },
  };

  const runs = Promise.all(
    config.checks.map((check) => {
      const { id: _id, kind, everyMin: _everyMin, ...params } = check;

      return (
        kinds[kind]?.({ ...params, ...localTargets[kind] }) ??
        Promise.reject(new Error(`no kind named ${kind}`))
      );
    }),
  );

  expect(runs).resolves.toSatisfyAll(Array.isArray);
});

test('it gives the dead session kind the sessions atc lists', async () => {
  const ctx = await setupTest();

  const kinds = await ctx.createKinds(
    [
      {
        descriptor: buildMockSessionDescriptor({
          id: 's1-k9q1r',
          name: 'build-lane',
          lifecycle: { desired: 'run', vm: 'none', harness: 'exited', attachment: 'local' },
        }),
        lastActivityAt: 1_794_900_000_000,
      },
    ],
    buildStubFetch({}).fetch,
  );

  const faults = await kinds['session-dead']?.({});

  expect(faults).toStrictEqual([
    {
      key: 's1-k9q1r',
      line: 'session build-lane is dead: atc wants it running, and its harness exited',
    },
  ]);
});

test('it gives the stuck session kind the last activity atc reads for each session', async () => {
  const ctx = await setupTest();

  const kinds = await ctx.createKinds(
    [
      {
        descriptor: buildMockSessionDescriptor({ id: 's2-m4x2p', name: 'idle-lane' }),
        lastActivityAt: 1_794_900_000_000 - 45 * 60_000,
      },
    ],
    buildStubFetch({}).fetch,
  );

  const faults = await kinds['session-stuck']?.({ stuckMin: 30 });

  expect(faults).toStrictEqual([
    { key: 's2-m4x2p', line: 'session idle-lane is running with no activity for 45 min' },
  ]);
});

test('it gives the stuck session kind no fault for a session active within stuckMin', async () => {
  const ctx = await setupTest();

  const kinds = await ctx.createKinds(
    [
      {
        descriptor: buildMockSessionDescriptor({ id: 's3-p7w2c', name: 'busy-lane' }),
        lastActivityAt: 1_794_900_000_000 - 10 * 60_000,
      },
    ],
    buildStubFetch({}).fetch,
  );

  const faults = await kinds['session-stuck']?.({ stuckMin: 30 });

  expect(faults).toStrictEqual([]);
});
