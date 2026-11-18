import type { Kind, NetPort } from '@stu/model';
import { z } from 'zod';

const TCP_PARAMS = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
});

export function makeTCPKind(net: NetPort): Kind {
  return async (params) => {
    const target = TCP_PARAMS.parse(params);
    const address = `${target.host}:${target.port}`;

    const reached = await net.probeTCP(target.host, target.port, { timeoutMs: 5000 });

    return reached ? [] : [{ key: address, line: `no answer from ${address}` }];
  };
}
