export function parseChildPIDs(text: string): number[] {
  return text
    .split(/\s+/u)
    .filter((word) => word !== '')
    .map(Number);
}
