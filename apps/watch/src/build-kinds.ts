import { makeAxiomAlertsKind } from '@stu/alerts-axiom';
import { makePrometheusAlertsKind } from '@stu/alerts-prometheus';
import { makeDiskKind, makeMemoryKind } from '@stu/host-linux';
import type {
  FetchHTTP,
  HostPort,
  KindTable,
  NetPort,
  RunProgram,
  SessionsPort,
  SleepMs,
} from '@stu/model';
import { makeHTTPKind, makeTCPKind } from '@stu/probe-net';
import { makeQuotaAnthropicKind } from '@stu/quota-anthropic';
import { makeDeadSessionKind, makeStuckSessionKind } from '@stu/sessions-atc';

export interface KindPorts {
  readonly host: HostPort;
  readonly net: NetPort;
  readonly sessions: SessionsPort;
  readonly readNowMs: () => number;
  readonly run: RunProgram;
  readonly fetch: FetchHTTP;
  readonly sleepMs: SleepMs;

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
    'alerts-prometheus': makePrometheusAlertsKind({ fetch: ports.fetch }),
    'alerts-axiom': makeAxiomAlertsKind({
      fetch: ports.fetch,
      readNowMs: ports.readNowMs,
      sleepMs: ports.sleepMs,
    }),
    'quota-anthropic': makeQuotaAnthropicKind({
      run: ports.run,
      fetch: ports.fetch,
      opEnv: ports.opEnv,
    }),
  };
}
