import { expect, onTestFinished, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from './create-host-linux.ts';

// skipIf reads this before the test runs, so setupTest() can't make it; a container may have no PSI.
const hasPressure = existsSync('/proc/pressure/memory');

function setupTest() {
  return { host: createHostLinux() };
}

test('#readMeminfo reads the host memory fields', async () => {
  const ctx = setupTest();

  const meminfo = await ctx.host.readMeminfo();

  expect(meminfo).toInclude('MemAvailable:');
});

test.skipIf(!hasPressure)('#readMemoryPressure reads the host memory pressure', async () => {
  const ctx = setupTest();

  const pressure = await ctx.host.readMemoryPressure();

  expect(pressure).toStartWith('some avg10=');
});

test('#readDiskUsage gives df a header and one line for each path', async () => {
  const ctx = setupTest();

  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const usage = await ctx.host.readDiskUsage([folder, folder]);

  expect(usage.trim().split('\n')).toHaveLength(3);
});

test('#readDiskUsage rejects for a path that does not exist', async () => {
  const ctx = setupTest();

  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  expect(ctx.host.readDiskUsage([join(folder, 'missing')])).rejects.toThrow();
});
