import { describe, expect, test } from "bun:test";

import Steam from "steam-user";

import type { SteamError } from "@/utils/steam-error";
import { invalidatesToken, isFatal } from "@/utils/steam-error";

function steamError(eresult?: Steam.EResult): SteamError {
  return Object.assign(new Error("test"), { eresult });
}

describe("invalidatesToken", () => {
  test.each([
    Steam.EResult.InvalidPassword,
    Steam.EResult.AccessDenied,
    Steam.EResult.Revoked,
    Steam.EResult.Expired,
  ])("is true for eresult %d", (eresult) => {
    expect(invalidatesToken(steamError(eresult))).toBe(true);
  });

  test.each([
    Steam.EResult.Invalid,
    Steam.EResult.Fail,
    Steam.EResult.NoConnection,
    Steam.EResult.LoggedInElsewhere,
    Steam.EResult.Busy,
    Steam.EResult.Timeout,
    Steam.EResult.ServiceUnavailable,
    Steam.EResult.LogonSessionReplaced,
    Steam.EResult.TryAnotherCM,
    Steam.EResult.RateLimitExceeded,
  ])("is false for eresult %d", (eresult) => {
    expect(invalidatesToken(steamError(eresult))).toBe(false);
  });

  test("is false when the error has no eresult", () => {
    expect(invalidatesToken(steamError())).toBe(false);
  });
});

describe("isFatal", () => {
  test.each([Steam.EResult.InvalidPassword, Steam.EResult.LogonSessionReplaced])(
    "is true for eresult %d",
    (eresult) => {
      expect(isFatal(steamError(eresult))).toBe(true);
    },
  );

  test.each([Steam.EResult.NoConnection, Steam.EResult.AccessDenied])(
    "is false for eresult %d",
    (eresult) => {
      expect(isFatal(steamError(eresult))).toBe(false);
    },
  );

  test("is false when the error has no eresult", () => {
    expect(isFatal(steamError())).toBe(false);
  });
});
