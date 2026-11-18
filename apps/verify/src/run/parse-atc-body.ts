import type { AtcAnswer } from '@stu/model';
import { match } from 'ts-pattern';
import type { z } from 'zod';

// The body of an answered call, parsed with the schema; a refusal or an unreached daemon throws
// with the procedure's name and the cause.
export function parseAtcBody<Schema extends z.ZodType>(
  procedure: string,
  answer: AtcAnswer,
  schema: Schema,
): z.output<Schema> {
  return match(answer)
    .with({ kind: 'answered' }, (answered) => schema.parse(answered.body))
    .with({ kind: 'refused' }, (refused) => {
      throw new Error(`atc refused ${procedure}: ${refused.code}`);
    })
    .with({ kind: 'unreached' }, (unreached) => {
      throw new Error(`atc call ${procedure} failed: ${unreached.reason}`);
    })
    .exhaustive();
}
