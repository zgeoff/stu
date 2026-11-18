// The state follows the command name, which can itself hold spaces and parentheses, so it is read
// after the last ')'. A zombie holds no files open and writes nothing, so it counts as gone.
export function isLiveProcessStat(stat: string): boolean {
  const fields = stat.slice(stat.lastIndexOf(')') + 1).trim();
  const [state] = fields.split(' ');

  return state !== undefined && state !== 'Z' && state !== 'X';
}
