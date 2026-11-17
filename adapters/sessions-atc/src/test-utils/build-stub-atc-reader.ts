import type { AtcReader } from '@stu/model';

// An atc reader that answers /session/list with the list answer and /session/get with the answer
// recorded for the session it names.
export function buildStubAtcReader(
  listAnswer: unknown,
  getAnswers: Readonly<Record<string, unknown>>,
): AtcReader {
  return {
    read: (path, input) => {
      const session = String(input['session']);
      const answer = path === '/session/list' ? listAnswer : getAnswers[session];

      return answer === undefined
        ? Promise.reject(new Error(`no recorded answer for ${path} ${session}`))
        : Promise.resolve({ kind: 'answered', body: answer });
    },
  };
}
