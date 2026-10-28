/** The caller owns retries; this boundary enforces a complete request deadline. */
export function researchModelBudget(seconds: unknown) {
  const value = seconds ?? 240;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 600) {
    throw new Error("modelTimeoutSeconds must be an integer between 1 and 600");
  }
  return { timeoutMs: value * 1000, maxRetries: 0 };
}

export async function withResearchModelDeadline<T>(requestSignal: AbortSignal, seconds: unknown,
  invoke: (options: { signal: AbortSignal; timeoutMs: number; maxRetries: number }) => Promise<T>): Promise<T> {
  const budget = researchModelBudget(seconds);
  requestSignal.throwIfAborted();
  const controller = new AbortController();
  const signal = AbortSignal.any([requestSignal, controller.signal]);
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(new DOMException("Research model deadline exceeded", "TimeoutError")), budget.timeoutMs);
  try { return await Promise.race([invoke({ ...budget, signal }), expired]); }
  finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
