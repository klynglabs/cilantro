# Plan 008: Only delete the saved login token when Steam actually rejected it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- src/events/steam.events.ts src/utils/`
> Expected: `src/events/steam.events.ts` (two `import type` lines swapped by
> plan 004), `src/utils/logger.ts` (plan 006) and new `*.test.ts` files from
> plans 005/006. Plan 006 must be DONE. If `onError` differs from the excerpt
> below, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/006-logger-errors-and-idempotent-token-delete.md
- **Category**: bug
- **Planned at**: commit `56ffc99`, 2026-09-28

## Project rules (apply to every change in this plan)

- Read `CLAUDE.md` in the repo root before starting and follow it throughout:
  think before coding (state assumptions, stop and ask when unclear),
  simplicity first (minimum code, nothing speculative), surgical changes
  (every changed line traces to this plan), goal-driven execution (every step
  has a verify command; loop until it passes).
- No useless comments. Add a comment only when the code cannot explain itself
  (a non-obvious *why*). Never restate what the code does and never mention
  this plan, a step, or "fix". The code in this plan needs no comments; the
  name `KEEP_TOKEN_RESULTS` carries the meaning.

## Why this matters

When Steam reports an error the handler doesn't recognize, `onError` deletes the
account's saved refresh token. That includes temporary conditions: Steam
maintenance (`ServiceUnavailable`), `Busy`, `Timeout`, `TryAnotherCM`,
`RateLimitExceeded`. After every Steam outage the user has to log in with their
password and type a new Steam Guard code, even though the token was fine. The
bot is meant to run unattended, so this is the most visible failure.

The handler also matches on `error.message` strings. steam-user puts the result
code in `error.eresult` (a number, typed as `Steam.EResult`); the message only
happens to be the enum name. Matching on `eresult` is the typed, reliable form.

After this plan, the token is deleted only for results that mean the
credentials themselves are bad (e.g. `AccessDenied`, `InvalidPassword`,
`Expired`, `Revoked`), and kept for transient/connection results and for
errors that have no `eresult` at all (e.g. `No Steam servers available`).

## Current state

- `src/events/steam.events.ts` imports (after plan 004):

  ```ts
  import type { Bot } from "@/bot";
  import type Steam from "steam-user";

  import { withStdinLock } from "@/utils/stdin-lock";
  ```

- `src/events/steam.events.ts` `onError` (lines ~38–59):

  ```ts
    private async onError(error: Error): Promise<void> {
      switch (error.message) {
        case "LogonSessionReplaced":
          this.bot.logger.error("Session replaced");
          return process.exit(1);
        case "InvalidPassword":
          this.bot.logger.error("Invalid credentials");
          await this.bot.tokens.del(this.bot.account.username);
          return process.exit(1);
        case "LoggedInElsewhere":
          this.bot.logger.warn("Logged in elsewhere");
          break;
        case "NoConnection":
          this.bot.logger.error("Connection dropped");
          break;
        default:
          this.bot.logger.error(error.message);
          await this.bot.tokens.del(this.bot.account.username);
      }

      await this.bot.reconnect();
    }
  ```

- How steam-user (v5.3.0) builds these errors, from `node_modules/steam-user/components/09-logon.js`:
  - logon failures: `new Error(EResult[body.eresult] || body.eresult)` with `error.eresult = body.eresult`
  - logoffs (`_handleLogOff`): `new Error(msg)` with `e.eresult = result`; steam-user
    itself treats `0`, `Fail`, `NoConnection`, `ServiceUnavailable` and `TryAnotherCM` as non-fatal
  - no CM server reachable: `new Error('No Steam servers available')` with **no** `eresult`
- `@types/steam-user` types the `error` event argument as
  `Error & { eresult: SteamUser.EResult }`. At runtime `eresult` can be
  missing, so the new `SteamError` type makes it optional.
- `Steam.EResult` is an enum on the default export: `import Steam from "steam-user"`
  then `Steam.EResult.AccessDenied` (value import — `import type` is not enough).
- Relevant numeric values (for reading test output): Invalid 0, Fail 2,
  NoConnection 3, InvalidPassword 5, LoggedInElsewhere 6, Busy 10,
  AccessDenied 15, Timeout 16, ServiceUnavailable 20, Revoked 26, Expired 27,
  LogonSessionReplaced 34, TryAnotherCM 48, RateLimitExceeded 84.
- Utility convention: small named-export modules in `src/utils/` (see
  `src/utils/retry.ts`), tests colocated as `<name>.test.ts`.

## Commands you will need

| Purpose      | Command                 | Expected on success                          |
|--------------|-------------------------|----------------------------------------------|
| Typecheck    | `bun run typecheck`     | exit 0                                       |
| Tests        | `bun run test`          | `0 fail`                                     |
| Format check | `bun run format:check`  | `All matched files use Prettier code style!` |

## Scope

**In scope**:
- `src/utils/steam-error.ts` (create)
- `src/utils/steam-error.test.ts` (create)
- `src/events/steam.events.ts` (`onError` and imports only)

**Out of scope**:
- The `process.exit(1)` calls and `this.bot.reconnect()` in `onError` — plan 009
  replaces this whole lifecycle; keep the control flow exactly as it is.
- `src/bot.ts`, `src/index.ts`.
- The Steam Guard handler (`onSteamGuard`).

## Git workflow

- Branch: `advisor/008-token-policy-by-eresult`
- Conventional commits, e.g. `fix(bot): keep token on transient steam errors`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create `src/utils/steam-error.ts`

```ts
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
```

Design choice (do not invert it): the list names the results that **keep** the
token. Any other result is treated as a credential problem, which keeps
today's intent ("an unexpected rejection clears a stale token") while fixing
the transient cases.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Create `src/utils/steam-error.test.ts`

```ts
import type { SteamError } from "@/utils/steam-error";

import { describe, expect, test } from "bun:test";
import Steam from "steam-user";

import { invalidatesToken } from "@/utils/steam-error";

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
```

**Verify**: `bun test src/utils/steam-error.test.ts` → `15 pass`, `0 fail`.

### Step 3: Switch `onError` to `eresult` and the new policy

In `src/events/steam.events.ts`:

1. Imports become (`Steam` is now a value import because the switch uses the enum):

   ```ts
   import type { Bot } from "@/bot";
   import type { SteamError } from "@/utils/steam-error";

   import Steam from "steam-user";

   import { withStdinLock } from "@/utils/stdin-lock";
   import { invalidatesToken } from "@/utils/steam-error";
   ```

2. `onError` becomes (only the parameter type, the `switch` subject, the
   `case` labels and the `default` branch's delete line change):

   ```ts
     private async onError(error: SteamError): Promise<void> {
       switch (error.eresult) {
         case Steam.EResult.LogonSessionReplaced:
           this.bot.logger.error("Session replaced");
           return process.exit(1);
         case Steam.EResult.InvalidPassword:
           this.bot.logger.error("Invalid credentials");
           await this.bot.tokens.del(this.bot.account.username);
           return process.exit(1);
         case Steam.EResult.LoggedInElsewhere:
           this.bot.logger.warn("Logged in elsewhere");
           break;
         case Steam.EResult.NoConnection:
           this.bot.logger.error("Connection dropped");
           break;
         default:
           this.bot.logger.error(error.message);
           if (invalidatesToken(error)) await this.bot.tokens.del(this.bot.account.username);
       }

       await this.bot.reconnect();
     }
   ```

**Verify**:
- `bun run typecheck` → exit 0
- `grep -c 'case "' src/events/steam.events.ts` → `0` (no string cases left)

### Step 4: Run all gates

**Verify**:
- `bun run test` → `34 pass`, `0 fail`
- `bun run format:check` → passes (run `bun run format` once if it doesn't)

## Test plan

- `src/utils/steam-error.test.ts` (new, 15 tests via `test.each`): 4 results
  that invalidate, 10 that keep, and a missing `eresult`.
- `onError` itself has no unit test here: it calls `process.exit` and
  `bot.reconnect()`, which plan 009 removes. Plan 009 adds lifecycle tests that
  cover the token policy end-to-end.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` reports `34 pass`, `0 fail`
- [ ] `grep -n "invalidatesToken(error)" src/events/steam.events.ts` → one match in the `default` branch
- [ ] `grep -c 'error.message)' src/events/steam.events.ts` → `1` (only the log line)
- [ ] `git diff --stat main...HEAD` lists only the three in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- `Steam.EResult.<name>` for any name above fails to typecheck (the installed
  `@types/steam-user` differs from 5.1.0).
- `import Steam from "steam-user"` in `steam.events.ts` causes a circular-import
  or runtime error when running `bun run test`.
- You find yourself changing the `process.exit` or `reconnect` flow — that is plan 009.

## Maintenance notes

- To keep the token for another transient result, add it to `KEEP_TOKEN_RESULTS`
  and to the "is false" `test.each` list.
- Plan 009 moves this `switch` into `Bot` and adds `isFatal` to the same
  `steam-error.ts` module; keep the two policies side by side there.
