import { describe, expect, test } from "bun:test";

import { withStdinLock } from "@/utils/stdin-lock";

describe("withStdinLock", () => {
  test("runs callbacks one at a time in call order", async () => {
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`${name}:start`);
      await Bun.sleep(ms);
      events.push(`${name}:end`);
      return name;
    };

    const results = await Promise.all([withStdinLock(task("a", 20)), withStdinLock(task("b", 1))]);

    expect(results).toEqual(["a", "b"]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("keeps the queue running after a rejection", async () => {
    const failed = withStdinLock(async () => {
      throw new Error("fail");
    });

    await expect(failed).rejects.toThrow("fail");
    expect(await withStdinLock(async () => "next")).toBe("next");
  });
});
