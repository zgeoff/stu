import type { DAEMON_CONTRACT } from '@atcx/contract';
import type { ContractRouterClient } from '@orpc/contract';

// One thing a check sees wrong now. The key is stable within its check, such as "/home" or a
// session id, so the same fault on the next run matches it.
export interface Fault {
  readonly key: string;

  // one line for a person, sent as written
  readonly line: string;
}

// A check kind: from its params to the faults it sees now. It throws when it cannot look.
export type Kind = (params: Readonly<Record<string, unknown>>) => Promise<readonly Fault[]>;

export type KindTable = Readonly<Record<string, Kind>>;

export interface OwedMessage {
  readonly text: string;
  readonly idempotencyKey: string;
}

// rekey: atc will never run anything under the key, so the send needs a new one. failed: atc may
// hold the message, and a resend under the same key settles it.
export type SendOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'rekey'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

export interface Notifier {
  readonly send: (message: OwedMessage) => Promise<SendOutcome>;
}

// A notifier kind: from the params of the config's notify block to the notifier. It throws on
// params it cannot use.
export type MakeNotifier = (params: Readonly<Record<string, unknown>>) => Notifier;

export type NotifierTable = Readonly<Record<string, MakeNotifier>>;

export type HTTPAnswer =
  | { readonly kind: 'answered'; readonly status: number }
  | { readonly kind: 'unreached'; readonly reason: string };

export interface ProbeOptions {
  readonly timeoutMs: number;
}

export interface NetPort {
  readonly probeTCP: (host: string, port: number, options: ProbeOptions) => Promise<boolean>;
  readonly readHTTP: (url: string, options: ProbeOptions) => Promise<HTTPAnswer>;
}

export interface HostPort {
  readonly readMeminfo: () => Promise<string>;
  readonly readMemoryPressure: () => Promise<string>;

  // `df -P -k` output for the paths
  readonly readDiskUsage: (paths: readonly string[]) => Promise<string>;
}

// The procedures of atc's published contract, as a client calls them.
export type AtcProcedures = ContractRouterClient<typeof DAEMON_CONTRACT>;

// The atc procedures that read and change nothing.
export interface AtcReadProcedures {
  readonly session: Pick<AtcProcedures['session'], 'list' | 'get'>;
  readonly message: Pick<AtcProcedures['message'], 'get'>;
}

// unreached: no daemon answered, so the call may not have reached atc at all
export type AtcAnswer =
  | { readonly kind: 'answered'; readonly body: unknown }
  | {
      readonly kind: 'refused';
      readonly code: string;
      readonly data: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'unreached'; readonly reason: string };

// Read-only access to atc: a package that holds only this port cannot send a message. The call
// gets atc's read procedures, and its answer comes back as the body of an answered call.
export interface AtcReader {
  readonly read: (call: (procedures: AtcReadProcedures) => Promise<unknown>) => Promise<AtcAnswer>;
}

export interface SessionSnapshot {
  readonly id: string;
  readonly name: string;
  readonly state: 'running' | 'needs_you' | 'done' | 'exited';
  readonly desired: 'run' | 'sleep' | 'stop';
  readonly harness: 'running' | 'suspended' | 'exited';

  // epoch ms of the session's last output or input
  readonly lastActivityAt: number;
}

export interface SessionsPort {
  readonly listSessions: () => Promise<readonly SessionSnapshot[]>;
}

export interface ProgramRunOptions {
  // the program's whole environment: it inherits nothing from the watcher's
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

// A program's exit code and stdout. The result has no stderr, so no caller can quote what a program
// echoes there, such as a secret it was given.
export interface ProgramResult {
  readonly code: number;
  readonly stdout: string;
}

export type RunProgram = (
  argv: readonly [string, ...string[]],
  options: ProgramRunOptions,
) => Promise<ProgramResult>;

// unread: the reason names neither the reference nor any secret, because it reaches stu.
export type SecretAnswer =
  | { readonly kind: 'read'; readonly value: string }
  | { readonly kind: 'unread'; readonly reason: string };

export interface SecretsPort {
  // the value of a secret reference, such as op://<vault_id>/<item_id>/credential
  readonly readSecret: (reference: string) => Promise<SecretAnswer>;
}

// The global fetch, narrowed to the one form the alert and quota kinds call.
export type FetchHTTP = (url: URL, init: RequestInit) => Promise<Response>;
