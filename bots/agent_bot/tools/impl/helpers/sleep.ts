/**
 * Sleep for `ms` milliseconds, or reject with Error('aborted') if the signal fires.
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
