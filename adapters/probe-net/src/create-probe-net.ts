import { once } from 'node:events';
import { createConnection } from 'node:net';
import type { NetPort } from '@stu/model';

export function createProbeNet(): NetPort {
  return {
    probeTCP: async (host, port, options) => {
      const socket = createConnection({ host, port });

      try {
        await once(socket, 'connect', { signal: AbortSignal.timeout(options.timeoutMs) });

        return true;
      } catch {
        return false;
      } finally {
        socket.destroy();
      }
    },
    readHTTP: async (url, options) => {
      try {
        const response = await fetch(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs),
        });

        await response.body?.cancel();

        return { kind: 'answered', status: response.status };
      } catch (error) {
        return {
          kind: 'unreached',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
