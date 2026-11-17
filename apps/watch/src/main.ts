import { resolveAtcPaths } from '@atcx/contract/light';
import { createHostLinux } from '@stu/host-linux';
import { createAtcNotifier, createAtcSocketClient } from '@stu/notifier-atc';
import { createProbeNet } from '@stu/probe-net';
import { createSessionsAtc } from '@stu/sessions-atc';
import packageJSON from '../package.json' with { type: 'json' };
import { buildKinds } from './build-kinds.ts';
import { runWatchOnce } from './run-watch-once.ts';

// The systemd user timer runs `bun apps/watch/src/main.ts <config path>` once a minute.
const configPath = process.argv.at(2);

if (configPath === undefined) {
  console.error('usage: bun apps/watch/src/main.ts <config path>');
  process.exit(2);
}

const atc = createAtcSocketClient({
  socketPath: resolveAtcPaths(process.env).socketPath,
  client: `stu-watch/${packageJSON.version}`,
  timeoutMs: 10_000,
});

const result = await runWatchOnce({
  configPath,
  at: Temporal.Now.instant(),
  kinds: buildKinds({
    host: createHostLinux(),
    net: createProbeNet(),
    sessions: createSessionsAtc(atc),
    readNowMs: () => Date.now(),
  }),
  createNotifier: (session) => createAtcNotifier({ client: atc, session, from: 'stu-watch' }),
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
