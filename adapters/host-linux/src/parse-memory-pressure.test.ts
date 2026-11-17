import { expect, test } from 'bun:test';
import { parseMemoryPressure } from './parse-memory-pressure.ts';

test('it reads the full avg60 share', () => {
  const fullAvg60 = parseMemoryPressure(
    'some avg10=4.10 avg60=8.25 avg300=2.00 total=123456\nfull avg10=1.50 avg60=3.75 avg300=0.80 total=65432\n',
  );

  expect(fullAvg60).toBe(3.75);
});

test('it throws on text without a full line', () => {
  expect(() => parseMemoryPressure('some avg10=4.10 avg60=8.25 avg300=2.00 total=1\n')).toThrow(
    'no full avg60',
  );
});
