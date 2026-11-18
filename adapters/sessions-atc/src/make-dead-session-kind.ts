import type { Kind, SessionsPort } from '@stu/model';

export function makeDeadSessionKind(sessions: SessionsPort): Kind {
  return async () => {
    const listed = await sessions.listSessions();

    return listed
      .filter((session) => session.desired === 'run' && session.harness === 'exited')
      .map((session) => ({
        key: session.id,
        line: `session ${session.name} is dead: atc wants it running, and its harness exited`,
      }));
  };
}
