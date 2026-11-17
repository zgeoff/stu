import { expect, mock, test } from 'bun:test';
import { join } from 'node:path';
import { buildKinds } from './build-kinds.ts';
import { readWatchConfig } from './read-watch-config.ts';

function setupTest() {
  return {
    kinds: buildKinds({
      host: {
        readMeminfo: mock(() =>
          Promise.resolve('MemTotal:  16777216 kB\nMemAvailable:  8388608 kB\n'),
        ),
        readMemoryPressure: mock(() =>
          Promise.resolve(
            'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
          ),
        ),
        readDiskUsage: mock(() =>
          Promise.resolve(
            'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 10 90 10% /\n',
          ),
        ),
      },
      net: {
        probeTCP: mock(() => Promise.resolve(true)),
        readHTTP: mock(() => Promise.resolve({ kind: 'answered' as const, status: 200 })),
      },
      sessions: { listSessions: mock(() => Promise.resolve([])) },
      readNowMs: () => 1_794_900_000_000,
    }),
  };
}

test('it runs every check of the example config to no fault on a healthy host', async () => {
  const ctx = setupTest();

  const config = await readWatchConfig(
    join(import.meta.dir, '..', 'stu-watch.config.example.json'),
  );

  const faults = await Promise.all(
    config.checks.map((check) => {
      const { id: _id, kind, everyMin: _everyMin, ...params } = check;

      return ctx.kinds[kind]?.(params) ?? Promise.reject(new Error(`no kind named ${kind}`));
    }),
  );

  expect(faults).toSatisfyAll((found: unknown) => Array.isArray(found) && found.length === 0);
});
