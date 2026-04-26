export const STDERR_CAP = 10 * 1024;

export function appendBoundedStderr(current: string, chunk: string, cap: number = STDERR_CAP): string {
  const next = current + chunk;
  return next.length <= cap ? next : next.slice(next.length - cap);
}
