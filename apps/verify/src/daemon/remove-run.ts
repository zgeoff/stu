import { readFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Subprocess } from 'bun';
import { isLiveProcessStat } from './is-live-process-stat.ts';
import { parseChildPIDs } from './parse-child-pids.ts';

export interface RunProcesses {
  readonly root: string;
  readonly daemon: Subprocess;

  // the daemon's children read once the session started, in case the daemon is gone at stop
  readonly sessionPIDs: readonly number[];
}

// wringer kills the launcher 5 s after its SIGTERM, so the session gets 3 s, then SIGKILL.
const SESSION_EXIT_GRACE_MS = 3000;
const SESSION_KILL_WAIT_MS = 1000;

// atc starts each session's claude as a child of the daemon in a process group of its own, so the
// SIGTERM to the launcher's group never reaches it. A claude that outlives the root writes its HOME
// back into the removed root, so the root goes only once every child has exited.
export async function removeRun(run: RunProcesses): Promise<void> {
  const daemonChildren = await readChildPIDs(run.daemon.pid);

  const children = [...new Set([...run.sessionPIDs, ...daemonChildren])];

  run.daemon.kill('SIGTERM');

  await run.daemon.exited;

  const survivors = await waitForExit(children, SESSION_EXIT_GRACE_MS);

  for (const pid of survivors) {
    killProcess(pid);
  }

  await waitForExit(survivors, SESSION_KILL_WAIT_MS);
  await rm(run.root, { recursive: true, force: true });
}

export async function readChildPIDs(pid: number): Promise<number[]> {
  const path = `/proc/${String(pid)}/task/${String(pid)}/children`;

  try {
    const children = await readFile(path, 'utf8');

    return parseChildPIDs(children);
  } catch {
    // the daemon has exited, and its children list with it
    return [];
  }
}

const EXIT_POLL_INTERVAL_MS = 100;

async function waitForExit(pids: readonly number[], timeoutMs: number): Promise<number[]> {
  const deadlineMs = performance.now() + timeoutMs;

  let live = await readLivePIDs(pids);

  while (live.length > 0 && performance.now() < deadlineMs) {
    await sleep(EXIT_POLL_INTERVAL_MS);

    live = await readLivePIDs(live);
  }

  return live;
}

async function readLivePIDs(pids: readonly number[]): Promise<number[]> {
  const probed = await Promise.all(
    pids.map(async (pid) => ({ pid, live: await probeProcess(pid) })),
  );

  return probed.filter((process) => process.live).map((process) => process.pid);
}

async function probeProcess(pid: number): Promise<boolean> {
  try {
    const stat = await readFile(`/proc/${String(pid)}/stat`, 'utf8');

    return isLiveProcessStat(stat);
  } catch {
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
