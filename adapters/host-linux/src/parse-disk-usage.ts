export interface DiskUsage {
  readonly usedPct: number;
  readonly availableKB: number;
}

// `df -P -k` output: a header, then one line per path asked for, in the order asked. The
// filesystem and the mount point may hold spaces, so the numbers are read from the middle.
export function parseDiskUsage(text: string): DiskUsage[] {
  return text
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const fields = /^.*?\s+\d+\s+\d+\s+(?<available>\d+)\s+(?<used>\d+)%\s+.*$/u.exec(
        line,
      )?.groups;

      const available = fields?.['available'];
      const used = fields?.['used'];

      if (available === undefined || used === undefined) {
        throw new Error(`df gave a line it cannot read: ${line}`);
      }

      return { availableKB: Number(available), usedPct: Number(used) };
    });
}
