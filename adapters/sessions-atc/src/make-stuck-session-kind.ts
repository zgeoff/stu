import type { Kind, SessionsPort } from '@stu/model';
import type { Clock } from '@zgeoff/std';
import { z } from 'zod';

const STUCK_PARAMS = z.object({
  // a running session with no activity for longer than this counts as stuck
  stuckMin: z.number().positive(),
});

export function makeStuckSessionKind(sessions: SessionsPort, clock: Pick<Clock, 'now'>): Kind {
  return async (params) => {
    const limits = STUCK_PARAMS.parse(params);

    const listed = await sessions.listSessions();

    const nowMs = clock.now();

    return listed
      .filter(
        (session) =>
          session.state === 'running' && nowMs - session.lastActivityAt > limits.stuckMin * 60_000,
      )
      .map((session) => ({
        key: session.id,
        line: `session ${session.name} is running with no activity for ${Math.floor((nowMs - session.lastActivityAt) / 60_000)} min`,
      }));
  };
}
