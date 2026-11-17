// A refusal from the atc daemon: its error code, such as "outcome_unknown", and the data that the
// code defines.
export class AtcError extends Error {
  readonly code: string;

  readonly data: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, data: Readonly<Record<string, unknown>> = {}) {
    super(message);

    this.name = 'AtcError';
    this.code = code;
    this.data = data;
  }
}
