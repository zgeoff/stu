import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedDaemonRecord } from './seed-daemon-record.ts';

async function setupTest() {
  const stateFolder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(stateFolder, { recursive: true, force: true }));

  return { stateFolder };
}

test('it writes daemon.json in the state folder', async () => {
  const ctx = await setupTest();

  await seedDaemonRecord({ stateFolder: ctx.stateFolder });

  const text = await readFile(join(ctx.stateFolder, 'daemon.json'), 'utf8');

  const written: unknown = JSON.parse(text);

  expect(written).toStrictEqual({
    pid: 4242,
    socketPath: '/tmp/stu-test/run/atc-daemon.sock',
    protocol: 15,
  });
});

test('it writes the socket path it is given', async () => {
  const ctx = await setupTest();

  await seedDaemonRecord(
    { stateFolder: ctx.stateFolder },
    { socketPath: '/tmp/stu-test/state/atc-daemon.sock' },
  );

  const text = await readFile(join(ctx.stateFolder, 'daemon.json'), 'utf8');

  const written: unknown = JSON.parse(text);

  expect(written).toMatchObject({ socketPath: '/tmp/stu-test/state/atc-daemon.sock' });
});
