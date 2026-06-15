# Plan 001: Delete stale token on auth error so reconnects fall back to password

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e868f9..HEAD -- src/events/steam.events.ts src/services/token.service.ts src/bot.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e868f9`, 2026-06-15

## Why this matters

`TokenService.del()` exists but is never called anywhere. When a Steam refresh
token expires or becomes invalid, the error falls through to the `default` branch
of `onError`, which calls `reconnect()`. But `reconnect()` → `start()` →
`getCredentials()` reads the same bad token from disk and returns it, so all 10
retry attempts fail identically with the same auth error. The bot goes permanently
offline with no way to recover short of manually deleting the token file.

The same issue exists for `InvalidPassword`: the process exits with the bad token
still on disk, so the next manual restart immediately tries (and fails with) the
same token again.

After this plan lands, auth errors clear the stored token so the next login
attempt uses username/password, which triggers a fresh token save via the
`refreshToken` event if successful.

## Current state

**`src/events/steam.events.ts` — the error handler (lines 37–56)**

```ts
private async onError(error: Error): Promise<void> {
  switch (error.message) {
    case "LogonSessionReplaced":
      this.bot.logger.error("Session replaced");
      return process.exit(1);
    case "InvalidPassword":
      this.bot.logger.error("Invalid credentials");
      return process.exit(1);
    case "LoggedInElsewhere":
      this.bot.logger.warn("Logged in elsewhere");
      break;
    case "NoConnection":
      this.bot.logger.error("Connection dropped");
      break;
    default:
      this.bot.logger.error(error.message);
  }

  await this.bot.reconnect();
}
```

**`src/services/token.service.ts` — del() exists but is never called (lines 27–29)**

```ts
async del(username: string): Promise<void> {
  await Bun.file(this.path(username)).delete();
}
```

**`src/bot.ts` — getCredentials() always prefers the stored token (lines 73–88)**

```ts
private async getCredentials(): Promise<Steam.LogOnDetailsRefresh | Steam.LogOnDetailsNamePass> {
  const token = await this.tokens.get(this.account.username);

  if (token) {
    return {
      refreshToken: token,
      renewRefreshTokens: true,
    } as Steam.LogOnDetailsRefresh;
  }

  return {
    accountName: this.account.username,
    password: this.account.password,
    renewRefreshTokens: true,
  } as Steam.LogOnDetailsNamePass;
}
```

**`src/bot.ts` — tokens is a public field (line 16)**

```ts
constructor(
  readonly account: Account,
  readonly tokens: TokenService,
  steamDataPath: string,
)
```

`this.bot.tokens` is accessible from `SteamEvents`.

**Repo convention**: errors are handled with `this.bot.logger.error(...)` then
either `process.exit(1)` or `await this.bot.reconnect()`. Match this style.

## Commands you will need

| Purpose    | Command              | Expected on success        |
|------------|----------------------|----------------------------|
| Typecheck  | `bun tsc --noEmit`   | exits 0, no output         |

(No test suite exists. Verification is typecheck + manual inspection.)

## Scope

**In scope** (the only file you should modify):
- `src/events/steam.events.ts`

**Out of scope** (do NOT touch):
- `src/services/token.service.ts` — `del()` is already correct; no changes needed
- `src/bot.ts` — no changes needed; `tokens` is already accessible
- Any other file

## Git workflow

- Branch: `advisor/001-stale-token-fix`
- Conventional Commits style (matches repo history): `fix(bot): delete stale token on auth error`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add token deletion before `InvalidPassword` exit

In `src/events/steam.events.ts`, replace the `InvalidPassword` case:

```ts
// before
case "InvalidPassword":
  this.bot.logger.error("Invalid credentials");
  return process.exit(1);
```

```ts
// after
case "InvalidPassword":
  this.bot.logger.error("Invalid credentials");
  await this.bot.tokens.del(this.bot.account.username);
  return process.exit(1);
```

**Verify**: `bun tsc --noEmit` → exits 0, no errors.

### Step 2: Add token deletion before reconnect in the `default` branch

In `src/events/steam.events.ts`, replace the `default` case:

```ts
// before
default:
  this.bot.logger.error(error.message);
```

```ts
// after
default:
  this.bot.logger.error(error.message);
  await this.bot.tokens.del(this.bot.account.username);
```

The `await this.bot.reconnect()` call that follows the switch statement is
unchanged. Deleting the token here ensures that `getCredentials()` falls back
to username/password on the next attempt. If auth succeeds, `onRefreshToken`
fires and saves a fresh token automatically.

Do NOT add token deletion to `LoggedInElsewhere` or `NoConnection` — those are
network failures; the token is still valid and should be reused on reconnect.

Do NOT add token deletion to `LogonSessionReplaced` — the token may still be
valid; the session replacement was caused by another client, not a bad token.

**Verify**: `bun tsc --noEmit` → exits 0, no errors.

### Step 3: Confirm no other callers need updating

```
grep -rn "tokens.del\|token.del" src/
```

Expected: still no matches (no other callers exist; that's the bug this plan
fixed by wiring up the existing `del()` at the right call sites).

## Test plan

No automated test infrastructure exists in this repo. Manual verification:

1. **Stale token — reconnect path**: place a file with garbage content in
   `.tokens/<encoded-username>`. Start the bot. Observe that it attempts login,
   gets an error, logs the error, deletes the token file (confirm `.tokens/`
   directory — file should be gone after the first error), and retries using
   username/password.

2. **InvalidPassword — clean exit**: same garbage token setup. If steam-user
   emits `InvalidPassword`, confirm the token file is deleted before the process
   exits, so the next run will prompt for credentials normally.

3. **NoConnection — token preserved**: simulate no internet (or use a test with
   a bad host). Confirm the token file is NOT deleted when a `NoConnection`
   error occurs.

## Done criteria

- [ ] `bun tsc --noEmit` exits 0
- [ ] `src/events/steam.events.ts` `InvalidPassword` case calls `await this.bot.tokens.del(this.bot.account.username)` before `process.exit(1)`
- [ ] `src/events/steam.events.ts` `default` case calls `await this.bot.tokens.del(this.bot.account.username)` before falling through to `reconnect()`
- [ ] `LoggedInElsewhere` and `NoConnection` cases do NOT call `tokens.del()`
- [ ] No files outside the in-scope list are modified (`git diff --name-only`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The code at the cited locations doesn't match the excerpts in "Current state."
- `bun tsc --noEmit` fails after your changes (do not push a type error).
- The `tokens` field on `Bot` is not accessible from `SteamEvents` (e.g., it was
  made private between when this plan was written and now).
- Applying the fix requires touching a file outside the in-scope list.

## Maintenance notes

- If a new error case is added to `onError` that also involves reconnecting after
  a possible auth failure, it should also call `tokens.del()` before
  `reconnect()`.
- The `default` branch now covers any steam-user error not explicitly handled.
  If a future PR adds an explicit case for a known-non-auth error (e.g.,
  `RateLimitExceeded`), that case should NOT call `tokens.del()` — move it above
  the default and handle it without token deletion.
- Deferred: adding a CLAUDE.md to document this error-handling pattern for future
  contributors.
