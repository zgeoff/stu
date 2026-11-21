import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makePrometheusAlertsKind } from '@stu/alerts-prometheus';
import { makeDiskKind, makeMemoryKind } from '@stu/host-linux';
import type { FetchHTTP, HostPort, KindTable, NetPort, RunProgram, SessionsPort } from '@stu/model';
import { makeHTTPKind, makeTCPKind } from '@stu/probe-net';
import { makeQuotaAnthropicKind } from '@stu/quota-anthropic';
import { makeDeadSessionKind, makeStuckSessionKind } from '@stu/sessions-atc';
import type { Clock } from '@zgeoff/std';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly clock: Pick<Clock, 'now' | 'sleep'>;
  readonly run: RunProgram;
  readonly fetch: FetchHTTP;

  // what op needs of the watcher's environment, such as PATH and HOME
  readonly opEnv: Readonly<Record<string, string>>;
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
    'quota-anthropic': makeQuotaAnthropicKind({
      run: ports.run,
      fetch: ports.fetch,
      opEnv: ports.opEnv,
    }),
  };
}
