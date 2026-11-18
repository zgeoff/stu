import type { ProgramResult, ProgramRunOptions } from '@stu/model';

// stderr is dropped unread, so nothing a program echoes there, such as a secret it was given, can
// reach a message.
export async function runProgram(
  argv: readonly [string, ...string[]],
  options: ProgramRunOptions,
): Promise<ProgramResult> {
  const child = Bun.spawn([...argv], {
    env: { ...options.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: options.timeoutMs,
    killSignal: 'SIGKILL',
  });

  const stdout = new Response(child.stdout).text();

  const code = await child.exited;

  // A child the program started can hold stdout open after the timeout kills the program, so a
  // killed program's stdout is never awaited.
  if (child.signalCode !== null) {
    return { code, stdout: '' };
  }

  return { code, stdout: await stdout };
}
