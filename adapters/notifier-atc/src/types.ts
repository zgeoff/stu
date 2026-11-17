import type { AtcAnswer, AtcReader } from '@stu/model';

export type AtcWritePath = '/session/message';

// One connection per call: the client opens it, says hello, makes the call and closes it.
export interface AtcSocketClient extends AtcReader {
  readonly write: (
    path: AtcWritePath,
    input: Readonly<Record<string, unknown>>,
  ) => Promise<AtcAnswer>;
}

export interface AtcSocketOptions {
  // tried in order until one has a daemon listening
  readonly socketPaths: AtcSocketPaths;

  // the build the hello names; atc labels a client whose name starts with "atc/" as the owner
  readonly client: string;
  readonly timeoutMs: number;
}

export type AtcSocketPaths = readonly [string, ...string[]];
