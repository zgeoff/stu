import { join } from 'node:path';
import { match } from 'ts-pattern';
import { readGateInput } from './read-gate-input.ts';

export async function runVerifyGate(env: Readonly<Record<string, string | undefined>>) {
  const eventPath = env['GITHUB_EVENT_PATH'];
  const tempDirectory = env['RUNNER_TEMP'];

  if (eventPath === undefined || tempDirectory === undefined) {
    process.stderr.write(
      '::error::set GITHUB_EVENT_PATH and RUNNER_TEMP; a pull_request run sets both\n',
    );

    return 1;
  }

  const event: unknown = await Bun.file(eventPath).json();

  const input = readGateInput(event);

  return match(input)
    .with({ kind: 'refused' }, (refused) => {
      process.stderr.write(`::error::${refused.message}\n`);

      return 1;
    })
    .with({ kind: 'gate' }, async (gate) => {
      const bodyFile = join(tempDirectory, 'pr-body.md');

      await Bun.write(bodyFile, gate.body);

      const child = Bun.spawn(
        ['bun', 'verify', 'gate', '--base', `origin/${gate.baseRef}`, '--body-file', bodyFile],
        { stdout: 'inherit', stderr: 'inherit' },
      );

      return child.exited;
    })
    .exhaustive();
}

if (import.meta.main) {
  process.exitCode = await runVerifyGate(process.env);
}
