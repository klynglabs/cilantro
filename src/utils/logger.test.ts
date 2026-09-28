import { describe, expect, spyOn, test } from "bun:test";

import { Logger } from "@/utils/logger";

const log = spyOn(console, "log").mockImplementation(() => {});

function printed(): string {
  return Bun.stripANSI(String(log.mock.lastCall?.[0]));
}

describe("Logger", () => {
  test("prints the message with app, level and context", () => {
    new Logger("alice").log("hello");

    expect(printed()).toMatch(/^\[Cilantro\] .+ LOG {3}\[alice\] hello$/);
  });

  test("prints an Error's stack", () => {
    new Logger().error("failed", new Error("boom"));

    expect(printed()).toContain("failed Error: boom");
    expect(printed()).toContain("logger.test.ts");
  });

  test("prints plain objects as JSON", () => {
    new Logger().log({ a: 1 });

    expect(printed()).toContain('{\n  "a": 1\n}');
  });
});
