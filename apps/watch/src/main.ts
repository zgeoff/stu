import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createHostLinux } from '@stu/host-linux';
import { createAtcSocketClient, readAtcSocketPaths } from '@stu/notifier-atc';
import { createProbeNet } from '@stu/probe-net';
import { createSecretsOp } from '@stu/secrets-op';
import { createSessionsAtc } from '@stu/sessions-atc';
import { readReported, writeReported } from '@stu/state-file';
import packageJSON from '../package.json' with { type: 'json' };
import { readWatchConfig } from './read-watch-config.ts';
import { runProgram } from './run-program.ts';
import { runWatchOnce } from './run-watch-once.ts';
import { buildKinds } from './tables/build-kinds.ts';
import { buildNotifiers } from './tables/build-notifiers.ts';

// The systemd user timer runs `bun apps/watch/src/main.ts <config path>` once a minute.
const [configPath] = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true }).positionals;

if (configPath === undefined) {
  console.error('usage: bun apps/watch/src/main.ts <config path>');
  process.exit(2);
}

const atc = createAtcSocketClient({
  socketPaths: await readAtcSocketPaths(process.env),
  client: `stu-watch/${packageJSON.version}`,
  timeoutMs: 10_000,
});

const result = await runWatchOnce({
  configPath,
  at: Temporal.Now.instant(),
  kinds: buildKinds({
    host: createHostLinux({ procRoot: '/proc' }),
    net: createProbeNet(),
    sessions: createSessionsAtc(atc),
    readNowMs: () => Date.now(),
    fetch,
  }),
  notifiers: buildNotifiers({ atc }),
  secrets: createSecretsOp({
    run: runProgram,
    opEnv: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },

    // from the environment, so the config holds no token; the service reads it from its env file
    serviceAccountToken: process.env['OP_SERVICE_ACCOUNT_TOKEN'],
  }),
  readNowMs: () => Date.now(),

  // node's sleep, not Bun.sleep: it takes an AbortSignal, so a kind that answers in time leaves no
  // timer running.
  sleepMs: (durationMs, signal) => sleep(durationMs, undefined, { signal }),
  readConfig: readWatchConfig,
  readReported,
  writeReported,
});

if (result.sent > 0 || result.failures.length > 0) {
  console.log(`stu-watch: sent ${result.sent}, failed ${result.failures.length}`);
}

for (const failure of result.failures) {
  console.error(`stu-watch: ${failure.key} stays owed: ${failure.reason}`);
}

// A kind that ran past its timeout may still hold a process or a socket, and the run is over.
const exitCode = result.failures.length > 0 ? 1 : 0;

process.exit(exitCode);
