import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WringerError } from '@wringer/core';
import type { DriveContext } from '@wringer/core';
import { RUN_ENDPOINTS_SCHEMA } from '../run/run-endpoints-schema.ts';
import { buildWatchCommand } from './build-watch-command.ts';
import { buildWatchConfig } from './build-watch-config.ts';

const WATCH_MAIN = join(import.meta.dir, '..', '..', '..', 'watch', 'src', 'main.ts');

export interface WatchPass {
  readonly port: 'closed' | 'open';

  // the PATH the watcher runs with, which finds `bun`
  readonly path: string;
}

export async function runWatch(ctx: DriveContext, pass: WatchPass): Promise<{ stdout: string }> {
  const run = RUN_ENDPOINTS_SCHEMA.parse(ctx.endpoints);
  const probePort = Number(run.probePort);
  const configPath = join(run.root, 'stu-watch.config.json');

  await writeFile(configPath, JSON.stringify(buildWatchConfig(run.session, probePort)));

  const command = buildWatchCommand(run, {
    path: pass.path,
    main: WATCH_MAIN,
    configPath,
  });

  const listener =
    pass.port === 'open'
      ? Bun.listen({
          hostname: '127.0.0.1',
          port: probePort,
          socket: {
            data: (socket) => {
              socket.end();
            },
          },
        })
      : null;

  try {
    const result = await ctx.exec(command);

    if (result.exitCode !== 0) {
      throw new WringerError('check-failed', {
        message: `the watcher exited ${String(result.exitCode)}`,
        data: { stdout: result.stdout, stderr: result.stderr },
      });
    }

    return { stdout: result.stdout.trim() };
  } finally {
    listener?.stop(true);
  }
}
