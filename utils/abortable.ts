/**
 * Small helpers for bounding async work with wall-clock timeouts while
 * cooperating with an external AbortSignal.
 *
 * `withTimeout(parent, ms)` returns a signal that fires when either `parent`
 * fires or `ms` elapses. `isTimeoutAbort(signal)` distinguishes the timeout
 * branch from external aborts so call sites can tailor their error messages.
 *
 * Implementation note: we avoid `AbortSignal.any` because the jest test
 * environment's AbortSignal polyfill lacks it. Instead we manually relay
 * abort events from the parent and a timer into a local AbortController.
 */

function makeTimeoutReason(ms: number): unknown {
  // DOMException exists in Node 22+ globally; fall back to a plain object
  // with the expected `name` so `isTimeoutAbort` still works.
  if (typeof DOMException !== 'undefined') {
    return new DOMException(`timeout after ${ms}ms`, 'TimeoutError');
  }
  const e = new Error(`timeout after ${ms}ms`);
  (e as { name: string }).name = 'TimeoutError';
  return e;
}

/**
 * Compose an AbortSignal that fires when either `parent` aborts or
 * `timeoutMs` elapses.
 *
 * Returns a `cleanup` function; call it in a finally block to release the
 * timeout timer. Cleanup is idempotent.
 */
export function withTimeout(
  parent: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cleaned = false;

  const onParentAbort = (): void => {
    if (controller.signal.aborted) return;
    controller.abort(parent.reason);
  };

  if (parent.aborted) {
    controller.abort(parent.reason);
  } else {
    parent.addEventListener('abort', onParentAbort, { once: true });
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      controller.abort(makeTimeoutReason(timeoutMs));
    }, timeoutMs);
    // Don't keep the Node process alive just for the timeout.
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  }

  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    parent.removeEventListener('abort', onParentAbort);
  };

  // Auto-cleanup when the composed signal fires so we don't leak the
  // parent listener even if callers forget `finally { cleanup() }`.
  controller.signal.addEventListener('abort', cleanup, { once: true });

  return { signal: controller.signal, cleanup };
}

/**
 * True when `signal.reason` indicates a timeout-triggered abort (vs. an
 * external AbortController.abort()). Matches DOMException('TimeoutError')
 * and plain Error objects with `name === 'TimeoutError'`.
 */
export function isTimeoutAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const reason = signal.reason;
  if (reason && typeof reason === 'object' && (reason as { name?: string }).name === 'TimeoutError') {
    return true;
  }
  return false;
}
