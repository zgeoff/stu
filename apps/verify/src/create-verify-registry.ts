import { join } from 'node:path';
import { createWringer, local } from '@wringer/core';
import type { LaunchPlan, Wringer } from '@wringer/core';
import { z } from 'zod';
import { checkDaemon } from './daemon/check-daemon.ts';
import { featurePaths, ignoredPaths, sharedPaths } from './feature-paths.ts';
import { INBOX_MESSAGE_SCHEMA, readInbox } from './inbox/read-inbox.ts';
import { openRunAtc } from './run/open-run-atc.ts';
import { RUN_ENDPOINTS_SCHEMA } from './run/run-endpoints-schema.ts';
import { runWatch } from './watch/run-watch.ts';

export function createVerifyRegistry(): Wringer {
  return createWringer({ name: 'stu-verify' })
    .target('local', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: createLaunchPlan,
    })
    .action({
      name: 'run-watch',
      summary:
        "Run the watcher once, with one tcp check on the run's probe port, while that port is closed or open",
      effect: 'write',
      targets: ['local'],
      input: z.strictObject({ port: z.enum(['closed', 'open']) }),
      data: z.strictObject({ stdout: z.string() }),
      timeoutMs: 60_000,
      run: (input, ctx) => runWatch(ctx, { port: input.port, path: process.env['PATH'] ?? '' }),
    })
    .command({
      path: ['inbox'],
      summary: "Read every message on the run's inbox session, oldest first",
      effect: 'read',
      args: z.strictObject({}),
      data: z.strictObject({ messages: z.array(INBOX_MESSAGE_SCHEMA) }),
      run: (_args, ctx) => {
        const run = RUN_ENDPOINTS_SCHEMA.parse(ctx.endpoints);

        return readInbox(openRunAtc(run.socket), run.session);
      },
    })
    .check({
      name: 'daemon',
      targets: ['local'],
      input: z.strictObject({}),
      data: z.strictObject({ socket: z.string(), session: z.string() }),
      timeoutMs: 10_000,
      run: (_input, ctx) => {
        const run = RUN_ENDPOINTS_SCHEMA.parse(ctx.endpoints);

        return checkDaemon(openRunAtc(run.socket), run);
      },
    })
    .feature({
      name: 'fault-messages',
      summary: 'A fault, then its recovery, reach an atc session as two messages from stu-watch',
      paths: featurePaths['fault-messages'],
    })
    .shared(...sharedPaths)
    .ignore(...ignoredPaths)
    .build();
}

// The launcher prints the ready line once the daemon answers and the inbox session runs.
function createLaunchPlan(): LaunchPlan {
  return {
    command: [process.execPath, join(import.meta.dir, 'daemon', 'run-local-daemon.ts')],
    ready: (line) => (line['event'] === 'ready' ? RUN_ENDPOINTS_SCHEMA.parse(line) : null),
  };
}
