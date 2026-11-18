import type { AtcAnswer, AtcInputs, AtcReadPath, AtcReader } from '@stu/model';

export type AtcWritePath = '/session/message';

export type AtcCallPath = AtcReadPath | AtcWritePath;

// One connection per call: the client opens it, says hello, makes the call and closes it.
export interface AtcSocketClient extends AtcReader {
  readonly write: <Path extends AtcWritePath>(
    path: Path,
    input: AtcInputs[Path],
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
