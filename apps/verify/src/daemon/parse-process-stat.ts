export interface ProcessStat {
  readonly state: string;
  readonly group: number;
}

// The fields follow the command name, which can itself hold spaces and parentheses, so they are
// read after the last ')': the state, the parent pid, then the process group.
export function parseProcessStat(stat: string): ProcessStat {
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim();
  const [state = '', , group = ''] = fields.split(' ');

  return { state, group: Number(group) };
}
