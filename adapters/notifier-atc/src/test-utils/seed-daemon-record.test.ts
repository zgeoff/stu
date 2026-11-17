import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDaemonRecord } from './seed-daemon-record.ts';

async function setupTest() {
  const stateDir = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(stateDir, { recursive: true, force: true }));

  return { stateDir };
}

test('it writes daemon.json in the state folder', async () => {
  const ctx = await setupTest();

  await seedDaemonRecord({ stateDir: ctx.stateDir });

  const text = await readFile(join(ctx.stateDir, 'daemon.json'), 'utf8');

  const written: unknown = JSON.parse(text);

  expect(written).toStrictEqual({
    pid: 4242,
    socketPath: '/tmp/stu-test/run/atc-daemon.sock',
    protocol: 14,
  });
});

test('it writes the socket path it is given', async () => {
  const ctx = await setupTest();

  await seedDaemonRecord(
    { stateDir: ctx.stateDir },
    { socketPath: '/tmp/stu-test/state/atc-daemon.sock' },
  );

  const text = await readFile(join(ctx.stateDir, 'daemon.json'), 'utf8');

  const written: unknown = JSON.parse(text);

  expect(written).toMatchObject({ socketPath: '/tmp/stu-test/state/atc-daemon.sock' });
});
