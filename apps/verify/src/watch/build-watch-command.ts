import type { RunEndpoints } from '../run/parse-run-endpoints.ts';

export interface WatchProgram {
  // the PATH the watcher runs with, which finds `bun`
  readonly path: string;

  // the watcher's entry point, the file the systemd unit runs
  readonly main: string;
  readonly configPath: string;
}

// `env -i` gives the watcher only the variables the systemd service gives it, so it finds the run's
// daemon through HOME and XDG_RUNTIME_DIR, never through the caller's ATC_* variables.
export function buildWatchCommand(run: RunEndpoints, program: WatchProgram): string[] {
  return [
    'env',
    '-i',
    `PATH=${program.path}`,
    `HOME=${run.home}`,
    `XDG_RUNTIME_DIR=${run.runtime}`,
    'bun',
    program.main,
    program.configPath,
  ];
}
