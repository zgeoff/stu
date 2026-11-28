import { createAtcClient } from '@stu/notifier-atc';
import type { AtcClient } from '@stu/notifier-atc';
import packageJSON from '../../package.json' with { type: 'json' };

// The run's daemon only: the one socket path keeps every call off the caller's own atc.
export function openRunAtc(socket: string): AtcClient {
  return createAtcClient({
    socketPath: socket,
    client: `stu-verify/${packageJSON.version}`,
    timeoutMs: 10_000,
  });
}
