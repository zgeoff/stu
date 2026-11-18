import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from './create-host-linux.ts';
import { makeMemoryKind } from './make-memory-kind.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const procRoot = join(folder, 'proc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(join(procRoot, 'pressure'), { recursive: true });

  return { procRoot, kind: makeMemoryKind(createHostLinux({ procRoot })) };
}

test('it sees a fault keyed available when memory available is under the limit', async () => {
  const ctx = await setupTest();

  await writeFile(
    join(ctx.procRoot, 'meminfo'),
    'MemTotal:       16777216 kB\nMemAvailable:     838861 kB\n',
  );

  const faults = await ctx.kind({ minAvailablePct: 10 });

  expect(faults).toStrictEqual([
    { key: 'available', line: 'memory available 5% (0.8 GiB of 16.0 GiB), under 10%' },
  ]);
});

test('it sees a fault keyed pressure when full avg60 is over the limit', async () => {
  const ctx = await setupTest();

  await writeFile(
    join(ctx.procRoot, 'meminfo'),
    'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n',
  );

  await writeFile(
    join(ctx.procRoot, 'pressure', 'memory'),
    'some avg10=0.00 avg60=30.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=25.00 avg300=0.00 total=1\n',
  );

  const faults = await ctx.kind({ minAvailablePct: 10, maxFullAvg60: 20 });

  expect(faults).toStrictEqual([
    { key: 'pressure', line: 'memory pressure full avg60 25%, over 20%' },
  ]);
});

test('it sees no fault when memory is within both limits', async () => {
  const ctx = await setupTest();

  await writeFile(
    join(ctx.procRoot, 'meminfo'),
    'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n',
  );

  await writeFile(
    join(ctx.procRoot, 'pressure', 'memory'),
    'some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=1.00 avg300=0.00 total=1\n',
  );

  const faults = await ctx.kind({ minAvailablePct: 10, maxFullAvg60: 20 });

  expect(faults).toStrictEqual([]);
});
