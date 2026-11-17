import { expect, test } from 'bun:test';
import { parseMeminfo } from './parse-meminfo.ts';

test('it reads the total and the available memory', () => {
  const meminfo = parseMeminfo(
    'MemTotal:       16303428 kB\nMemFree:          612340 kB\nMemAvailable:    1630342 kB\nBuffers:          120044 kB\n',
  );

  expect(meminfo).toStrictEqual({ totalKB: 16_303_428, availableKB: 1_630_342 });
});

test('it throws on text without MemAvailable', () => {
  expect(() => parseMeminfo('MemTotal:       16303428 kB\n')).toThrow('no MemAvailable');
});
