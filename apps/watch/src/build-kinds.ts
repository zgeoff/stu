import { createDiskKind, createMemoryKind } from '@stu/host-linux';
import type { HostPort, KindTable, NetPort, SessionsPort } from '@stu/model';
import { createHttpKind, createTcpKind } from '@stu/probe-net';
import { createDeadSessionKind, createStuckSessionKind } from '@stu/sessions-atc';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly readNowMs: () => number;
}

// The kind names a check's `kind` field takes.
export function buildKinds(ports: KindPorts): KindTable {
  return {
    memory: createMemoryKind(ports.host),
    disk: createDiskKind(ports.host),
    tcp: createTcpKind(ports.net),
    http: createHttpKind(ports.net),
    'session-dead': createDeadSessionKind(ports.sessions),
    'session-stuck': createStuckSessionKind(ports.sessions, ports.readNowMs),
  };
}
