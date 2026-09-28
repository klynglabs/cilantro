import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TokenService } from "@/services/token.service";

let dir: string;
let tokens: TokenService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cilantro-tokens-"));
  tokens = new TokenService(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TokenService", () => {
  test("returns undefined for a missing token", async () => {
    expect(await tokens.get("alice")).toBeUndefined();
  });

  test("stores and reads a token", async () => {
    await tokens.set("alice", "token-1");
    expect(await tokens.get("alice")).toBe("token-1");
  });

  test("trims whitespace and treats an empty file as missing", async () => {
    await tokens.set("alice", "  token-1\n");
    await tokens.set("bob", "  \n");

    expect(await tokens.get("alice")).toBe("token-1");
    expect(await tokens.get("bob")).toBeUndefined();
  });

  test("encodes the username in the file name", async () => {
    await tokens.set("a@b", "token-1");
    expect(existsSync(join(dir, "a%40b"))).toBe(true);
  });

  test("deletes a stored token", async () => {
    await tokens.set("alice", "token-1");
    await tokens.del("alice");
    expect(await tokens.get("alice")).toBeUndefined();
  });
});
