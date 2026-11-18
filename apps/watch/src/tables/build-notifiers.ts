import type { NotifierTable } from '@stu/model';
import { makeAtcNotifier } from '@stu/notifier-atc';
import type { AtcSocketClient } from '@stu/notifier-atc';

export interface NotifierPorts {
  readonly atc: AtcSocketClient;
}

export function buildNotifiers(ports: NotifierPorts): NotifierTable {
  return {
    atc: makeAtcNotifier({ client: ports.atc, from: 'stu-watch' }),
  };
}
