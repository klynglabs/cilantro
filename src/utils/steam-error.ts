import Steam from "steam-user";

export type SteamError = Error & { eresult?: Steam.EResult };

const KEEP_TOKEN_RESULTS = new Set([
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
]);

export function invalidatesToken({ eresult }: SteamError): boolean {
  return eresult !== undefined && !KEEP_TOKEN_RESULTS.has(eresult);
}

export function isFatal({ eresult }: SteamError): boolean {
  return (
    eresult === Steam.EResult.InvalidPassword || eresult === Steam.EResult.LogonSessionReplaced
  );
}
