import { makeDiskKind, makeMemoryKind } from '@stu/host-linux';
import type { HostPort, KindTable, NetPort, SessionsPort } from '@stu/model';
import { makeHTTPKind, makeTCPKind } from '@stu/probe-net';
import { makeDeadSessionKind, makeStuckSessionKind } from '@stu/sessions-atc';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly readNowMs: () => number;
}

export function buildKinds(ports: KindPorts): KindTable {
  return {
    memory: makeMemoryKind(ports.host),
    disk: makeDiskKind(ports.host),
    tcp: makeTCPKind(ports.net),
    http: makeHTTPKind(ports.net),
    'session-dead': makeDeadSessionKind(ports.sessions),
    'session-stuck': makeStuckSessionKind(ports.sessions, ports.readNowMs),
  };
}
