import type { AtcAnswer, AtcProcedures, AtcReader } from '@stu/model';

// One connection per call: the client connects, says hello, makes the call and closes.
export interface AtcClient extends AtcReader {
  readonly write: (call: (procedures: AtcProcedures) => Promise<unknown>) => Promise<AtcAnswer>;
}

export interface AtcClientOptions {
  // the name the daemon logs and shows
  readonly client: string;

  // a unix socket that skips the search for the daemon's socket; undefined: search, as atc's own
  // clients do
  readonly socketPath?: string;

  // the connect, the hello and the call together
  readonly timeoutMs: number;
}
