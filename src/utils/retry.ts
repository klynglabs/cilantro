interface RetryOptions {
  attempts: number;
  delayMs: number;
  factor: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, total: number, delay: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts, delayMs, factor, shouldRetry, onRetry }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts - 1 || shouldRetry?.(err) === false) throw err;

      const delay = delayMs * factor ** attempt;
      onRetry?.(attempt + 1, attempts, delay);
      await Bun.sleep(delay);
    }
  }
}
