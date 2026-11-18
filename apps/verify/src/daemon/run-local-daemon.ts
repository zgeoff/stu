import { closeSync, openSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { SPAWN_ANSWER_SCHEMA } from '@atcx/contract';
import { resolveAtcPaths } from '@atcx/contract/light';
import type { AtcSocketClient } from '@stu/notifier-atc';
import type { Subprocess } from 'bun';
import { openRunAtc } from '../run/open-run-atc.ts';
import { parseAtcBody } from '../run/parse-atc-body.ts';
import type { RunEndpoints } from '../run/run-endpoints-schema.ts';

const DAEMON_READY_TIMEOUT_MS = 30_000;
const DAEMON_POLL_INTERVAL_MS = 100;

export async function runLocalDaemon(env: Readonly<Record<string, string | undefined>>) {
  // A Unix socket path holds at most 108 bytes, so the root goes under /tmp, never under the
  // caller's TMPDIR or the repo's .wringer folder, either of which can be long.
  const root = await mkdtemp('/tmp/stu-verify-');

  const home = join(root, 'home');
  const runtime = join(root, 'run');

  await mkdir(home);
  await mkdir(runtime);
  await chmod(runtime, 0o700);

  const daemonEnv = { PATH: env['PATH'] ?? '', HOME: home, XDG_RUNTIME_DIR: runtime };
  const socket = resolveAtcPaths(daemonEnv).daemonSocketPath;
  const log = openSync(join(root, 'daemon.log'), 'a');

  // Only these three variables: the session's claude inherits the daemon's environment, and the
  // caller's holds ATC_* variables and agent credentials.
  const daemon = Bun.spawn(['atc', 'daemon'], {
    env: daemonEnv,
    stdin: 'ignore',
    stdout: log,
    stderr: log,
  });

  closeSync(log);

  const stop = async () => {
    daemon.kill('SIGTERM');

    await daemon.exited;
    await rm(root, { recursive: true, force: true });
  };

  const stopAndExit = async () => {
    await stop();

    process.exit(0);
  };

  process.once('SIGTERM', () => void stopAndExit());
  process.once('SIGINT', () => void stopAndExit());

  let run: RunEndpoints;

  try {
    const atc = openRunAtc(socket);

    await waitForDaemon(atc, daemon);

    const session = await createInboxSession(atc, root);

    run = { root, home, runtime, socket, session, probePort: String(readFreePort()) };
  } catch (error) {
    await stop();

    throw error;
  }

  process.stdout.write(`${JSON.stringify({ event: 'ready', ...run })}\n`);

  const exitCode = await daemon.exited;

  await rm(root, { recursive: true, force: true });

  process.exitCode = exitCode;
}

async function waitForDaemon(atc: AtcSocketClient, daemon: Subprocess) {
  const deadlineMs = performance.now() + DAEMON_READY_TIMEOUT_MS;

  while (performance.now() < deadlineMs) {
    if (daemon.exitCode !== null) {
      throw new Error(`atc daemon exited ${String(daemon.exitCode)} before it answered`);
    }

    const answer = await atc.read((procedures) => procedures.session.list({}));

    if (answer.kind === 'answered') {
      return;
    }

    await sleep(DAEMON_POLL_INTERVAL_MS);
  }

  throw new Error(`atc daemon gave no answer in ${String(DAEMON_READY_TIMEOUT_MS)} ms`);
}

async function createInboxSession(atc: AtcSocketClient, root: string): Promise<string> {
  const answer = await atc.write((procedures) =>
    procedures.session.spawn({ cwd: root, name: 'stu-inbox', agent: 'claude' }),
  );

  return parseAtcBody('/session/spawn', answer, SPAWN_ANSWER_SCHEMA).session.id;
}

function readFreePort(): number {
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data: (socket) => {
        socket.end();
      },
    },
  });

  const port = listener.port;

  listener.stop(true);

  return port;
}

if (import.meta.main) {
  await runLocalDaemon(process.env);
}
