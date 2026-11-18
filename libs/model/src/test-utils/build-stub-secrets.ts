import type { SecretAnswer, SecretsPort } from '../types.ts';

// A secrets port that answers each reference it holds with its value, and any other reference as
// unread. It records each reference it is asked for.
export function buildStubSecrets(values: Readonly<Record<string, string>>) {
  const reads: string[] = [];

  const secrets: SecretsPort = {
    readSecret: (ref) => {
      reads.push(ref);

      const value = Object.hasOwn(values, ref) ? values[ref] : undefined;

      const answer: SecretAnswer =
        value === undefined
          ? { kind: 'unread', reason: 'the stub holds no such secret' }
          : { kind: 'read', value };

      return Promise.resolve(answer);
    },
  };

  return { secrets, reads };
}
