import { realpath } from 'node:fs/promises';
import { SESSION_DESCRIPTOR_SCHEMA } from '@atcx/contract';
import type { AtcReader } from '@stu/model';
import { WringerError } from '@wringer/core';
import { z } from 'zod';
import { parseAtcBody } from '../run/parse-atc-body.ts';
import type { RunEndpoints } from '../run/run-endpoints-schema.ts';
import { isInsideFolder } from './is-inside-folder.ts';

const SESSION_GET_SCHEMA = z.object({
  session: SESSION_DESCRIPTOR_SCHEMA.pick({ lifecycle: true }),
});

// The doctor's daemon check: the socket sits in the run's own root, never the caller's daemon, and
// the inbox session's claude runs, since atc refuses a message to a dead session. It compares real
// paths, so a link in the root to another daemon's socket fails it.
export async function checkDaemon(
  atc: AtcReader,
  run: RunEndpoints,
): Promise<{ socket: string; session: string }> {
  const root = await realpath(run.root);
  const socket = await realpath(run.socket);

  if (!isInsideFolder(root, socket)) {
    throw new WringerError('check-failed', {
      message: `the daemon socket ${socket} is outside the run's root ${root}`,
    });
  }

  const answer = await atc.read((procedures) => procedures.session.get({ session: run.session }));

  const harness = parseAtcBody('/session/get', answer, SESSION_GET_SCHEMA).session.lifecycle
    .harness;

  if (harness !== 'running') {
    throw new WringerError('check-failed', {
      message: `the inbox session ${run.session} has harness ${harness}, not running`,
    });
  }

  return { socket: run.socket, session: run.session };
}
