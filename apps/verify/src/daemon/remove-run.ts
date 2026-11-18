import { readFile, readdir, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Subprocess } from 'bun';
import { isRunEnviron } from './is-run-environ.ts';
import { parseProcessStat } from './parse-process-stat.ts';

export interface RunProcesses {
  readonly root: string;
  readonly home: string;
  readonly daemon: Subprocess;
}

// wringer kills the launcher 5 s after its SIGTERM, so the run's other processes get 3 s, then
// SIGKILL.
const EXIT_GRACE_MS = 3000;
const KILL_WAIT_MS = 1000;

// atc starts each session's claude in a process group of its own, so the SIGTERM to the launcher's
// group never reaches it or the hooks it runs. Any of them that outlives the root writes into its
// HOME and brings the root back, so the root goes only once no live process has HOME in it.
export async function removeRun(run: RunProcesses): Promise<void> {
  run.daemon.kill('SIGTERM');

  await run.daemon.exited;

  const survivors = await waitForRunExit(run.home, EXIT_GRACE_MS);

  for (const pid of survivors) {
    killProcess(pid);
  }

  await waitForRunExit(run.home, KILL_WAIT_MS);

  // rm's own retries cover a file written into the root while it removes it
  await rm(run.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const EXIT_POLL_INTERVAL_MS = 100;

async function waitForRunExit(home: string, timeoutMs: number): Promise<number[]> {
  const deadlineMs = performance.now() + timeoutMs;

  let live = await readRunPIDs(home);

  while (live.length > 0 && performance.now() < deadlineMs) {
    await sleep(EXIT_POLL_INTERVAL_MS);

    live = await readRunPIDs(home);
  }

  return live;
}

async function readRunPIDs(home: string): Promise<number[]> {
  const entries = await readdir('/proc');

  const pids = entries.filter((entry) => /^\d+$/u.test(entry)).map(Number);

  const found = await Promise.all(pids.map((pid) => probeRunProcess(pid, home)));

  return pids.filter((_pid, index) => found[index] === true);
}

// A zombie writes nothing, so it counts as gone.
async function probeRunProcess(pid: number, home: string): Promise<boolean> {
  try {
    const statText = await readFile(`/proc/${String(pid)}/stat`, 'utf8');

    const stat = parseProcessStat(statText);

    const environ = await readFile(`/proc/${String(pid)}/environ`, 'utf8');

    return stat.state !== 'Z' && stat.state !== 'X' && isRunEnviron(environ, home);
  } catch {
    // the process exited between the listing and the read, or belongs to another user
    return false;
  }
}

function killProcess(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // it exited between the last poll and the kill
  }
}
