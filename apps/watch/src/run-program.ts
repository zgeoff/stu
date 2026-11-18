import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { finished } from 'node:stream/promises';
import type { ProgramResult, ProgramRunOptions } from '@stu/model';
import invariant from 'tiny-invariant';

interface ProgramExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

// stderr is dropped unread, so nothing a program echoes there, such as a secret it was given, can
// reach a message. Bun.spawn has no detached option, so node:child_process starts the program in a
// process group of its own, and the timeout kills that whole group.
export async function runProgram(
  argv: readonly [string, ...string[]],
  options: ProgramRunOptions,
): Promise<ProgramResult> {
  const [command, ...args] = argv;

  const child = spawn(command, args, {
    env: { ...options.env },
    stdio: ['ignore', 'pipe', 'ignore'],
    detached: true,
  });

  let stdout = '';

  child.stdout.setEncoding('utf8');

  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });

  const exited = new Promise<ProgramExit>((resolve, reject) => {
    child.once('error', reject);

    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  // A process the program left running can hold stdout open after the program exits, so the
  // timeout runs until stdout closes as well.
  const ended = Promise.all([exited, finished(child.stdout)]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<'timed-out'>((resolve) => {
    timer = setTimeout(() => {
      killProcessGroup(child.pid);
      resolve('timed-out');
    }, options.timeoutMs);
  });

  const outcome = await Promise.race([ended, timedOut]).finally(() => {
    clearTimeout(timer);
  });

  // A grandchild that left the group, through setsid, can hold stdout open after the kill, so a
  // killed program's stdout is never awaited.
  if (outcome === 'timed-out') {
    return { code: 128 + constants.signals.SIGKILL, stdout: '' };
  }

  const [exit] = outcome;

  return { code: toExitCode(exit), stdout };
}

function killProcessGroup(pid: number | undefined): void {
  invariant(pid !== undefined, 'a program that failed to start has no timeout running');

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    // The group is gone when its last process exits just before the timer fires, and the events
    // that clear the timer have not run yet.
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw error;
    }
  }
}

function toExitCode(exit: ProgramExit): number {
  if (exit.signal !== null) {
    return 128 + constants.signals[exit.signal];
  }

  invariant(exit.code !== null, 'a program that exits without a signal has an exit code');

  return exit.code;
}
