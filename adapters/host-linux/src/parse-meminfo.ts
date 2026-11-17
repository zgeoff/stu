export interface Meminfo {
  readonly totalKB: number;
  readonly availableKB: number;
}

// /proc/meminfo: one "Name:   value kB" line per field.
export function parseMeminfo(text: string): Meminfo {
  return {
    totalKB: getField(text, 'MemTotal'),
    availableKB: getField(text, 'MemAvailable'),
  };
}

function getField(text: string, name: string): number {
  const found = new RegExp(`^${name}:\\s+(?<value>\\d+) kB$`, 'mu').exec(text)?.groups?.['value'];

  if (found === undefined) {
    throw new Error(`/proc/meminfo has no ${name}`);
  }

  return Number(found);
}
