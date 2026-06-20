const DEFAULT_RETRY_DELAY_MS = 1_000;
const JITTER_MS = 500;
const RATE_LIMIT_DELAY_MS = 5 * 60_000;

const rateLimitUntilByKey = new Map<string, number>();

export type ExternalCallOptions<T> = {
  label: string;
  context: Record<string, unknown>;
  fn: () => Promise<T>;
  rateLimitKey?: string;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function httpStatusError(message: string, status: number): Error {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

export async function withExternalCall<T>(options: ExternalCallOptions<T>): Promise<T | null> {
  const { label, context, fn, rateLimitKey } = options;

  if (rateLimitKey) {
    const retryAt = rateLimitUntilByKey.get(rateLimitKey) ?? 0;
    if (Date.now() < retryAt) {
      console.warn(`[warn] ${label} skipped because rate limit backoff is active.`, {
        ...context,
        retryAt: new Date(retryAt).toISOString(),
      });
      return null;
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const status = getStatusCode(error);
      console.warn(`[warn] ${label} failed on attempt ${attempt}.`, {
        ...context,
        status,
        error,
      });

      if (status === 429) {
        if (rateLimitKey) {
          rateLimitUntilByKey.set(rateLimitKey, Date.now() + RATE_LIMIT_DELAY_MS);
        }
        console.warn(`[warn] ${label} received HTTP 429; skipping this round.`, {
          ...context,
          nextRetryAfterMs: RATE_LIMIT_DELAY_MS,
        });
        return null;
      }

      if (attempt === 1) {
        await sleep(DEFAULT_RETRY_DELAY_MS + Math.floor(Math.random() * JITTER_MS));
      }
    }
  }

  console.warn(`[warn] ${label} failed after retry; skipping this round.`, context);
  return null;
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const maybeStatus = (error as { status?: unknown; statusCode?: unknown }).status;
  if (typeof maybeStatus === "number") return maybeStatus;

  const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof maybeStatusCode === "number") return maybeStatusCode;

  return undefined;
}
