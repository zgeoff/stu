import type { MakeNotifier } from '@stu/model';
import { z } from 'zod';
import { createAtcNotifier } from './create-atc-notifier.ts';
import type { AtcClient } from './types.ts';

export interface AtcNotifierPorts {
  readonly client: AtcClient;

  // the name atc labels a local program's message with
  readonly from: string;
}

const ATC_NOTIFY_PARAMS = z.strictObject({
  // the atc id of the session that gets each message
  session: z.string().min(1),
});

export function makeAtcNotifier(ports: AtcNotifierPorts): MakeNotifier {
  return (params) => {
    const atc = ATC_NOTIFY_PARAMS.parse(params);

    return createAtcNotifier({ client: ports.client, session: atc.session, from: ports.from });
  };
}
