import { expect, mock, test } from 'bun:test';
import { createDiskKind } from './create-disk-kind.ts';

function setupTest() {
  return {
    createKind: (df: string) =>
      createDiskKind({
        readMeminfo: mock(() => Promise.reject(new Error('the disk kind reads no memory'))),
        readMemoryPressure: mock(() => Promise.reject(new Error('the disk kind reads no memory'))),
        readDiskUsage: mock(() => Promise.resolve(df)),
      }),
  };
}

test('it sees one fault keyed by the path for each filesystem over the limit', async () => {
  const ctx = setupTest();

  const kind = ctx.createKind(
    [
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/sda1        100000000  95000000   5242880      95% /',
      '/dev/sdb1        100000000  10000000  90000000      10% /srv',
    ].join('\n'),
  );

  const faults = await kind({ paths: ['/', '/srv'], maxUsedPct: 90 });

  expect(faults).toStrictEqual([{ key: '/', line: '/ is 95% full (5.0 GiB free), over 90%' }]);
});

test('it throws when df gives fewer lines than the paths asked for', () => {
  const ctx = setupTest();

  const kind = ctx.createKind(
    'Filesystem     1024-blocks      Used Available Capacity Mounted on\n',
  );

  expect(kind({ paths: ['/'], maxUsedPct: 90 })).rejects.toThrow('no line for /');
});
