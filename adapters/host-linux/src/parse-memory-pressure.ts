// /proc/pressure/memory: the share of the last 60 s in which every task waited on memory, from
// its "full avg10=… avg60=…" line.
export function parseMemoryPressure(text: string): number {
  const found = /^full .*\bavg60=(?<avg60>[\d.]+)/mu.exec(text)?.groups?.['avg60'];

  if (found === undefined) {
    throw new Error('/proc/pressure/memory has no full avg60');
  }

  return Number(found);
}
