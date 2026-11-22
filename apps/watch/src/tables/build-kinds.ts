import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makePrometheusAlertsKind } from '@stu/alerts-prometheus';
import { makeDiskKind, makeMemoryKind } from '@stu/host-linux';
import type { FetchHTTP, HostPort, KindTable, NetPort, SessionsPort } from '@stu/model';
import { makeHTTPKind, makeTCPKind } from '@stu/probe-net';
import { makeQuotaAnthropicKind } from '@stu/quota-anthropic';
import { makeDeadSessionKind, makeStuckSessionKind } from '@stu/sessions-atc';
import type { Clock } from '@zgeoff/std';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly clock: Pick<Clock, 'now' | 'sleep'>;
  readonly fetch: FetchHTTP;
}

export function buildKinds(ports: KindPorts): KindTable {
  return {
    memory: makeMemoryKind(ports.host),
    disk: makeDiskKind(ports.host),
    tcp: makeTCPKind(ports.net),
    http: makeHTTPKind(ports.net),
    'session-dead': makeDeadSessionKind(ports.sessions),
    'session-stuck': makeStuckSessionKind(ports.sessions, ports.clock),
    'alerts-prometheus': makePrometheusAlertsKind({ fetch: ports.fetch }),
    'alerts-axiom': makeAxiomAlertsKind({
      fetch: ports.fetch,
      clock: ports.clock,
    }),
    'quota-anthropic': makeQuotaAnthropicKind({ fetch: ports.fetch }),
  };
}
