// The record atc's daemon writes to daemon.json in its state folder when it starts. atc publishes no
// type for it, so this holds the fields the record carries, with invented values.
export interface DaemonRecord {
  readonly pid: number;
  readonly socketPath: string;
  readonly protocol: number;
}

export function buildMockDaemonRecord(overrides: Partial<DaemonRecord> = {}): DaemonRecord {
  return {
    pid: 4242,
    socketPath: '/tmp/stu-test/run/atc-daemon.sock',
    protocol: 14,
    ...overrides,
  };
}
