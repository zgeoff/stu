import { createHash } from 'node:crypto';

export function buildSendKey(faultKey: string, owed: 'open' | 'clear', since: string): string {
  const hash = createHash('sha256').update(`${faultKey}\n${owed}\n${since}`).digest('hex');

  return `stu-watch:${hash.slice(0, 32)}`;
}

// The key for a send that atc will never run under its old key: the old key with a counter.
export function buildNextSendKey(sendKey: string): string {
  const [base, count] = sendKey.split(':').length === 3 ? splitCounter(sendKey) : [sendKey, 1];

  return `${base}:${count + 1}`;
}

function splitCounter(sendKey: string): [string, number] {
  const at = sendKey.lastIndexOf(':');

  return [sendKey.slice(0, at), Number(sendKey.slice(at + 1))];
}
