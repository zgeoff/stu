export function buildNextSendKey(sendKey: string): string {
  const [base, count] = sendKey.split(':').length === 3 ? splitCounter(sendKey) : [sendKey, 1];

  return `${base}:${count + 1}`;
}

function splitCounter(sendKey: string): [string, number] {
  const at = sendKey.lastIndexOf(':');

  return [sendKey.slice(0, at), Number(sendKey.slice(at + 1))];
}
