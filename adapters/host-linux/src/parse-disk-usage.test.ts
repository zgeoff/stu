import { expect, test } from 'bun:test';
import { parseDiskUsage } from './parse-disk-usage.ts';

test('it reads the share used and the space available of each line, in order', () => {
  const usage = parseDiskUsage(
    [
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      '/dev/nvme0n1p2   491134216 466577504  24556712      95% /',
      'tank data        1000000000 100000000 900000000     10% /mnt/tank data',
      '',
    ].join('\n'),
  );

  expect(usage).toStrictEqual([
    { availableKB: 24_556_712, usedPct: 95 },
    { availableKB: 900_000_000, usedPct: 10 },
  ]);
});

test('it throws on a line without the numbers df prints', () => {
  expect(() =>
    parseDiskUsage('Filesystem 1024-blocks Used Available Capacity Mounted on\nbroken\n'),
  ).toThrow('cannot read');
});
