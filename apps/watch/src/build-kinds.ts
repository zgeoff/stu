import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makePrometheusAlertsKind } from '@stu/alerts-prometheus';
import { makeDiskKind, makeMemoryKind } from '@stu/host-linux';
import type { HostPort, KindTable, NetPort, RunProgram, SessionsPort } from '@stu/model';
import { makeHTTPKind, makeTCPKind } from '@stu/probe-net';
import { makeQuotaAnthropicKind } from '@stu/quota-anthropic';
import { makeDeadSessionKind, makeStuckSessionKind } from '@stu/sessions-atc';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly readNowMs: () => number;
  readonly run: RunProgram;

  // Anthropic's messages endpoint, which the quota kind reads each slot's use from
  readonly messagesURL: string;

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
    'session-stuck': makeStuckSessionKind(ports.sessions, ports.readNowMs),
    'alerts-prometheus': makePrometheusAlertsKind(),
    'alerts-axiom': makeAxiomAlertsKind({ readNowMs: ports.readNowMs }),
    'quota-anthropic': makeQuotaAnthropicKind({
      run: ports.run,
      messagesURL: ports.messagesURL,
      opEnv: ports.opEnv,
    }),
  };
}
