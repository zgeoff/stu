import type { AtcAnswer, AtcProcedures, AtcReader } from '@stu/model';

// One connection per call: the client opens it, says hello, makes the call and closes it.
export interface AtcSocketClient extends AtcReader {
  readonly write: (call: (procedures: AtcProcedures) => Promise<unknown>) => Promise<AtcAnswer>;
}

export interface AtcSocketOptions {
  // tried in order until one has a daemon listening
  readonly socketPaths: AtcSocketPaths;

  // the build the hello names; atc labels a client whose name starts with "atc/" as the owner
  readonly client: string;
  readonly timeoutMs: number;
}

export type AtcSocketPaths = readonly [string, ...string[]];
