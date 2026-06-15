interface RetryOptions {
  attempts: number;
  delayMs: number;
  factor: number;
  onRetry?: (attempt: number, total: number, delay: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts, delayMs, factor, onRetry }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts - 1) throw err;

      const delay = delayMs * factor ** attempt;
      onRetry?.(attempt + 1, attempts, delay);
      await Bun.sleep(delay);
    }
  }
}
