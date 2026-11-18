// /proc/<pid>/environ holds each variable followed by a NUL byte.
export function isRunEnviron(environ: string, home: string): boolean {
  return environ.split('\0').includes(`HOME=${home}`);
}
