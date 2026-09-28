import { describe, expect, mock, test } from "bun:test";

import { withRetry } from "@/utils/retry";

const options = { attempts: 3, delayMs: 1, factor: 2 };

describe("withRetry", () => {
  test("returns the first successful result", async () => {
    const fn = mock(async () => "ok");

    expect(await withRetry(fn, options)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries until success", async () => {
    let calls = 0;
    const fn = mock(async () => {
      if (++calls < 3) throw new Error("fail");
      return "ok";
    });

    expect(await withRetry(fn, options)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("throws the last error after all attempts", async () => {
    const fn = mock(async () => {
      throw new Error("fail");
    });

    await expect(withRetry(fn, options)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("reports each retry with an exponential delay", async () => {
    const onRetry = mock((_attempt: number, _total: number, _delay: number) => {});
    const fn = async () => {
      throw new Error("fail");
    };

    await expect(withRetry(fn, { ...options, onRetry })).rejects.toThrow();
    expect(onRetry.mock.calls).toEqual([
      [1, 3, 1],
      [2, 3, 2],
    ]);
  });

  test("stops when shouldRetry returns false", async () => {
    const fn = mock(async () => {
      throw new Error("fatal");
    });

    await expect(withRetry(fn, { ...options, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
