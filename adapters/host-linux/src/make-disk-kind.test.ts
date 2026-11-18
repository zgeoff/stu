import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostLinux } from './create-host-linux.ts';
import { makeDiskKind } from './make-disk-kind.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'stu-test-'));

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  return { folder, kind: makeDiskKind(createHostLinux({ procRoot: join(folder, 'proc') })) };
}

// df rounds a filesystem's share in use up to a whole percent, so one that holds the test's folder
// is at least 1% full.
test('it sees one fault keyed by the path for a filesystem over the limit', async () => {
  const ctx = await setupTest();
  const faults = await ctx.kind({ paths: [ctx.folder], maxUsedPct: 0 });

  expect(faults).toStrictEqual([
    {
      key: ctx.folder,
      line: expect.stringMatching(/ is \d+% full \(\d+\.\d GiB free\), over 0%$/u),
    },
  ]);
});

test('it sees no fault for a filesystem within the limit', async () => {
  const ctx = await setupTest();
  const faults = await ctx.kind({ paths: [ctx.folder, ctx.folder], maxUsedPct: 100 });

  expect(faults).toStrictEqual([]);
});

test('it throws for a path that does not exist', async () => {
  const ctx = await setupTest();

  expect(ctx.kind({ paths: [join(ctx.folder, 'missing')], maxUsedPct: 90 })).rejects.toThrow();
});
