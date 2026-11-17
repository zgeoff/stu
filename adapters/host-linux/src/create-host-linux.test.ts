import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from './create-host-linux.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  const procRoot = join(folder, 'proc');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  await mkdir(join(procRoot, 'pressure'), { recursive: true });

  return { folder, procRoot, host: createHostLinux({ procRoot }) };
}

test('#readMeminfo reads the meminfo file under the proc root', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.procRoot, 'meminfo'), 'MemTotal: 16384 kB\nMemAvailable: 8192 kB\n');

  const meminfo = await ctx.host.readMeminfo();

  expect(meminfo).toBe('MemTotal: 16384 kB\nMemAvailable: 8192 kB\n');
});

test('#readMemoryPressure reads the memory pressure file under the proc root', async () => {
  const ctx = await setupTest();

  await writeFile(
    join(ctx.procRoot, 'pressure', 'memory'),
    'some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
  );

  const pressure = await ctx.host.readMemoryPressure();

  expect(pressure).toStartWith('some avg10=0.00');
});

test('#readMemoryPressure rejects on a host without memory pressure', async () => {
  const ctx = await setupTest();

  expect(ctx.host.readMemoryPressure()).rejects.toThrow('ENOENT');
});

test('#readDiskUsage gives df a header and one line for each path', async () => {
  const ctx = await setupTest();
  const usage = await ctx.host.readDiskUsage([ctx.folder, ctx.folder]);

  expect(usage.trim().split('\n')).toHaveLength(3);
});

test('#readDiskUsage rejects for a path that does not exist', async () => {
  const ctx = await setupTest();

  expect(ctx.host.readDiskUsage([join(ctx.folder, 'missing')])).rejects.toThrow();
});
