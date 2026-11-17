import { expect, mock, test } from 'bun:test';
import { makeMemoryKind } from './make-memory-kind.ts';

function setupTest() {
  return {
    createKind: (meminfo: string, pressure: string) =>
      makeMemoryKind({
        readMeminfo: mock(() => Promise.resolve(meminfo)),
        readMemoryPressure: mock(() => Promise.resolve(pressure)),
        readDiskUsage: mock(() => Promise.reject(new Error('the memory kind reads no disk'))),
      }),
  };
}

test('it sees a fault keyed available when memory available is under the limit', async () => {
  const ctx = setupTest();
  const kind = ctx.createKind('MemTotal:       16777216 kB\nMemAvailable:     838861 kB\n', '');

  const faults = await kind({ minAvailablePct: 10 });

  expect(faults).toStrictEqual([
    { key: 'available', line: 'memory available 5% (0.8 GiB of 16.0 GiB), under 10%' },
  ]);
});

test('it sees a fault keyed pressure when full avg60 is over the limit', async () => {
  const ctx = setupTest();

  const kind = ctx.createKind(
    'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n',
    'some avg10=0.00 avg60=30.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=25.00 avg300=0.00 total=1\n',
  );

  const faults = await kind({ minAvailablePct: 10, maxFullAvg60: 20 });

  expect(faults).toStrictEqual([
    { key: 'pressure', line: 'memory pressure full avg60 25%, over 20%' },
  ]);
});

test('it sees no fault when memory is within both limits', async () => {
  const ctx = setupTest();

  const kind = ctx.createKind(
    'MemTotal:       16777216 kB\nMemAvailable:    8388608 kB\n',
    'some avg10=0.00 avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=1.00 avg300=0.00 total=1\n',
  );

  const faults = await kind({ minAvailablePct: 10, maxFullAvg60: 20 });

  expect(faults).toStrictEqual([]);
});
