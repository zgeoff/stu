import type { NotifierTable } from '@stu/model';
import { makeAtcNotifier } from '@stu/notifier-atc';
import type { AtcClient } from '@stu/notifier-atc';

export interface NotifierPorts {
  readonly atc: AtcClient;
}

export function buildNotifiers(ports: NotifierPorts): NotifierTable {
  return {
    atc: makeAtcNotifier({ client: ports.atc, from: 'stu-watch' }),
  };
}
