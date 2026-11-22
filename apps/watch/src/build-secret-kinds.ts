import type { Kind, KindTable, SecretAnswer, SecretsPort } from '@stu/model';
import { match } from 'ts-pattern';

// The kinds share one cache of answers, so a reference that several checks use costs one 1Password
// read a run.
export function buildSecretKinds(kinds: KindTable, secrets: SecretsPort): KindTable {
  const answers = new Map<string, Promise<SecretAnswer>>();

  const readSecret = (reference: string): Promise<SecretAnswer> => {
    const answer = answers.get(reference) ?? secrets.readSecret(reference);

    answers.set(reference, answer);

    return answer;
  };

  return Object.fromEntries(
    Object.entries(kinds).map(([name, kind]) => [name, makeSecretKind(kind, readSecret)]),
  );
}

// The thrown message reaches stu, so it names the param's path and never the reference or a value.
function makeSecretKind(
  kind: Kind,
  readSecret: (reference: string) => Promise<SecretAnswer>,
): Kind {
  return async (params) => {
    const references = collectSecretReferences(params, []);

    const answers = await Promise.all(
      references.map(async (secret) => ({ secret, answer: await readSecret(secret.reference) })),
    );

    // in the order of the params, so the first unread reference is the same on every run
    const values = new Map(answers.map((read) => [read.secret.reference, toSecretValue(read)]));

    const masks = buildSecretMasks(answers, values);

    // A kind can quote any param, such as a slot id, so the value never reaches stu through it.
    const faults = await kind(buildResolvedParams(params, values)).catch((error: unknown) => {
      throw toMaskedError(error, masks);
    });

    return faults.map((fault) => ({
      key: toMaskedText(fault.key, masks),
      line: toMaskedText(fault.line, masks),
    }));
  };
}

interface SecretReference {
  // where the reference sits in the params, such as "slots.1.token"
  readonly path: string;
  readonly reference: string;
}

const SECRET_REFERENCE_PREFIX = 'op://';

function collectSecretReferences(value: unknown, path: readonly string[]): SecretReference[] {
  if (typeof value === 'string') {
    return value.startsWith(SECRET_REFERENCE_PREFIX)
      ? [{ path: path.join('.'), reference: value }]
      : [];
  }

  if (typeof value !== 'object' || value === null) {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    collectSecretReferences(child, [...path, key]),
  );
}

interface SecretRead {
  readonly secret: SecretReference;
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

interface SecretMask {
  readonly value: string;

  // names the param's path, so two masked values in fault keys stay two faults
  readonly label: string;
}

// The longest value goes first, so a value that holds a shorter one is masked whole.
function buildSecretMasks(
  answers: readonly SecretRead[],
  values: ReadonlyMap<string, string>,
): SecretMask[] {
  const labels = new Map<string, string>();

  for (const read of answers) {
    const value = values.get(read.secret.reference);

    if (value !== undefined && !labels.has(value)) {
      labels.set(value, `[secret at ${read.secret.path}]`);
    }
  }

  return [...labels]
    .map(([value, label]) => ({ value, label }))
    .toSorted((first, second) => second.value.length - first.value.length);
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

// A kind can throw a value that is not an Error, such as a string, and the engine sends its text.
function toMaskedError(error: unknown, masks: readonly SecretMask[]): unknown {
  if (!(error instanceof Error)) {
    return new Error(toMaskedText(String(error), masks));
  }

  if (!masks.some((mask) => error.message.includes(mask.value))) {
    return error;
  }

  return new Error(toMaskedText(error.message, masks));
}

function toMaskedText(text: string, masks: readonly SecretMask[]): string {
  return masks.reduce((masked, mask) => masked.replaceAll(mask.value, mask.label), text);
}
