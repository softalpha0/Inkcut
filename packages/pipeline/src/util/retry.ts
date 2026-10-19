import { LIMITS } from "@inkcut/shared";

export interface RetryOptions {
  /** Retries after the first attempt. Default: LIMITS.networkRetries (3). */
  retries?: number;
  /** Per-attempt timeout in ms. The signal passed to `fn` aborts when it expires. */
  timeoutMs: number;
  /** First backoff delay in ms; doubles each retry (with jitter). */
  baseDelayMs?: number;
  /** Return false to fail immediately (e.g. 4xx auth errors). */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs one attempt with a hard timeout, aborting the signal handed to `fn`. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(timeoutMs));
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** HTTP status found on SDK errors (OpenAI, fal) or our own HttpError. */
export function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return undefined;
}

/** Retry timeouts, network failures, 408, 409, 429 and 5xx; never other 4xx. */
export function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  if (status === undefined) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions): Promise<T> {
  const retries = opts.retries ?? LIMITS.networkRetries;
  const base = opts.baseDelayMs ?? 1000;
  const shouldRetry = opts.shouldRetry ?? isRetryable;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(fn, opts.timeoutMs);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = Math.round(base * 2 ** attempt * (0.75 + Math.random() * 0.5));
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
