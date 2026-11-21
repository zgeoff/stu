import { mock } from 'bun:test';
import type { Fault, Kind } from '@stu/model';
import { makeAnswerQueue } from '@zgeoff/testing/mocks';

// A kind that gives each answer in turn, one per run: the faults it sees, or the error it throws.
export function makeStubKind(answers: readonly (readonly Fault[] | Error)[]) {
  const next = makeAnswerQueue(answers);

  return mock<Kind>(async () => {
    const answer = await Promise.try(next);

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });
}
