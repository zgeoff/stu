// A plain object inherits Object's members, so an index such as "constructor" finds one unless the
// lookup takes own properties only.
export function findOwn<Value>(
  record: Readonly<Record<string, Value>>,
  key: string,
): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
