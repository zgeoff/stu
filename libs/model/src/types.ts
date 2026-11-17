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

// The atc procedures that read and change nothing.
export type AtcReadPath = '/session/list' | '/session/get' | '/message/get';

// Read-only access to atc: a package that holds only this port cannot send a message.
export interface AtcReader {
  readonly read: (path: AtcReadPath, input: Readonly<Record<string, unknown>>) => Promise<unknown>;
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
