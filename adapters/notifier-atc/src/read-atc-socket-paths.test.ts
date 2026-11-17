import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAtcSocketPaths } from './read-atc-socket-paths.ts';
import { buildSeeder } from './test-utils/build-seeder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const home = join(folder, 'home');
  const stateDir = join(home, '.local', 'state', 'atc');
  const runtimeDir = join(folder, 'run');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(stateDir, { recursive: true });

  return {
    home,
    runtimeDir,
    stateDir,
    seed: buildSeeder({ stateDir }),
  };
}

test('it gives the client socket under XDG_RUNTIME_DIR when the daemon left no record', async () => {
  const ctx = await setupTest();
  const paths = await readAtcSocketPaths({ HOME: ctx.home, XDG_RUNTIME_DIR: ctx.runtimeDir });

  expect(paths).toStrictEqual([join(ctx.runtimeDir, 'atc-daemon.sock')]);
});

test('it gives the client socket under the state folder when XDG_RUNTIME_DIR is unset', async () => {
  const ctx = await setupTest();
  const paths = await readAtcSocketPaths({ HOME: ctx.home });

  expect(paths).toStrictEqual([join(ctx.stateDir, 'atc-daemon.sock')]);
});

test('it gives the socket the daemon record holds after the computed one when the two differ', async () => {
  const ctx = await setupTest();

  await ctx.seed.daemonRecord({ socketPath: join(ctx.stateDir, 'atc-daemon.sock') });

  const paths = await readAtcSocketPaths({ HOME: ctx.home, XDG_RUNTIME_DIR: ctx.runtimeDir });

  expect(paths).toStrictEqual([
    join(ctx.runtimeDir, 'atc-daemon.sock'),
    join(ctx.stateDir, 'atc-daemon.sock'),
  ]);
});

test('it gives the computed socket once when the daemon record holds the same one', async () => {
  const ctx = await setupTest();

  await ctx.seed.daemonRecord({ socketPath: join(ctx.runtimeDir, 'atc-daemon.sock') });

  const paths = await readAtcSocketPaths({ HOME: ctx.home, XDG_RUNTIME_DIR: ctx.runtimeDir });

  expect(paths).toStrictEqual([join(ctx.runtimeDir, 'atc-daemon.sock')]);
});

test.each(['{"pid": 42', '{"pid": 4242}'])(
  'it ignores a daemon record it cannot read: %s',
  async (record) => {
    const ctx = await setupTest();

    // a torn or incomplete record, which no seed writes because atc's schema refuses it
    await writeFile(join(ctx.stateDir, 'daemon.json'), record);

    const paths = await readAtcSocketPaths({
      HOME: ctx.home,
      XDG_RUNTIME_DIR: ctx.runtimeDir,
    });

    expect(paths).toStrictEqual([join(ctx.runtimeDir, 'atc-daemon.sock')]);
  },
);

test('it rejects when the daemon record exists but cannot be read', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.stateDir, 'daemon.json'));

  const paths = readAtcSocketPaths({ HOME: ctx.home, XDG_RUNTIME_DIR: ctx.runtimeDir });

  expect(paths).rejects.toMatchObject({ code: 'EISDIR' });
});
