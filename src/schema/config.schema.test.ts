import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ConfigSchema } from "@/schema/config.schema";

const account = { username: "TEST_USER", password: "TEST_PASS", games: [730] };
const config = { accounts: [account], steamData: "./.steam", tokens: "./.tokens" };

beforeEach(() => {
  Bun.env.TEST_USER = "alice";
  Bun.env.TEST_PASS = "secret";
});

afterEach(() => {
  delete Bun.env.TEST_USER;
  delete Bun.env.TEST_PASS;
});

describe("ConfigSchema", () => {
  test("resolves credentials from environment variables", () => {
    const [parsed] = ConfigSchema.parse(config).accounts;

    expect(parsed).toEqual({ username: "alice", password: "secret", games: [730], online: false });
  });

  test("rejects an empty account list", () => {
    expect(() => ConfigSchema.parse({ ...config, accounts: [] })).toThrow(
      "No accounts found in config file",
    );
  });

  test("throws when an environment variable is missing", () => {
    delete Bun.env.TEST_PASS;

    expect(() => ConfigSchema.parse(config)).toThrow(
      "Missing required environment variable: TEST_PASS",
    );
  });

  test("rejects a resolved username with invalid characters", () => {
    Bun.env.TEST_USER = "alice smith";

    expect(() => ConfigSchema.parse(config)).toThrow();
  });
});
