import { createHash } from 'node:crypto';

export function buildSendKey(faultKey: string, owed: 'open' | 'clear', since: string): string {
  const hash = createHash('sha256').update(`${faultKey}\n${owed}\n${since}`).digest('hex');

  return `stu-watch:${hash.slice(0, 32)}`;
}
