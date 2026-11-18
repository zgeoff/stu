import type { Kind, KindTable, SecretAnswer, SecretsPort } from '@stu/model';
import { match } from 'ts-pattern';

// The kinds share one cache of answers, so a reference that several checks use costs one 1Password
// read a run.
export function buildSecretKinds(kinds: KindTable, secrets: SecretsPort): KindTable {
  const answers = new Map<string, Promise<SecretAnswer>>();

  const readSecret = (ref: string): Promise<SecretAnswer> => {
    const answer = answers.get(ref) ?? secrets.readSecret(ref);

    answers.set(ref, answer);

    return answer;
  };

  return Object.fromEntries(
    Object.entries(kinds).map(([name, kind]) => [name, makeSecretKind(kind, readSecret)]),
  );
}

// The thrown message reaches stu, so it names the param's path and never the reference or a value.
function makeSecretKind(kind: Kind, readSecret: (ref: string) => Promise<SecretAnswer>): Kind {
  return async (params) => {
    const refs = collectSecretRefs(params, []);

    const answers = await Promise.all(
      refs.map(async (secret) => ({ secret, answer: await readSecret(secret.ref) })),
    );

    // in the order of the params, so the first unread reference is the same on every run
    const values = new Map(answers.map((read) => [read.secret.ref, toSecretValue(read)]));

    const secretValues = [...values.values()];

    // A kind can quote any param, such as a slot id, so the value never reaches stu through it.
    const faults = await kind(buildResolvedParams(params, values)).catch((error: unknown) => {
      throw toMaskedError(error, secretValues);
    });

    return faults.map((fault) => ({
      key: toMaskedText(fault.key, secretValues),
      line: toMaskedText(fault.line, secretValues),
    }));
  };
}

interface SecretRef {
  // where the reference sits in the params, such as "slots.1.token"
  readonly path: string;
  readonly ref: string;
}

const SECRET_REF_PREFIX = 'op://';

function collectSecretRefs(value: unknown, path: readonly string[]): SecretRef[] {
  if (typeof value === 'string') {
    return value.startsWith(SECRET_REF_PREFIX) ? [{ path: path.join('.'), ref: value }] : [];
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => collectSecretRefs(child, [...path, key]));
}

interface SecretRead {
  readonly secret: SecretRef;
  readonly answer: SecretAnswer;
}

function toSecretValue(read: SecretRead): string {
  return match(read.answer)
    .with({ kind: 'read' }, (answer) => answer.value)
    .with({ kind: 'unread' }, (unread) => {
      throw new Error(`the secret at ${read.secret.path}: ${unread.reason}`);
    })
    .exhaustive();
}

function buildResolvedParams(
  params: object,
  values: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, buildResolvedValue(value, values)]),
  );
}

function buildResolvedValue(value: unknown, values: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') {
    return values.get(value) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((child: unknown) => buildResolvedValue(child, values));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return buildResolvedParams(value, values);
}

function toMaskedError(error: unknown, secretValues: readonly string[]): unknown {
  if (!(error instanceof Error) || !secretValues.some((value) => error.message.includes(value))) {
    return error;
  }

  return new Error(toMaskedText(error.message, secretValues));
}

function toMaskedText(text: string, secretValues: readonly string[]): string {
  return secretValues.reduce((masked, value) => masked.replaceAll(value, '[secret]'), text);
}
