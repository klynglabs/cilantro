let queue = Promise.resolve();

export function withStdinLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}
