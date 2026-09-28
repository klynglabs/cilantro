# Plan 009: Give each bot one owner for login, errors and reconnects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- src/bot.ts src/index.ts src/events/steam.events.ts src/utils/retry.ts src/utils/steam-error.ts`
> Plans 005, 006 and 008 must be DONE. Expected changes: `src/bot.ts` (import
> reorder from plan 004 and `EConnectionProtocol.WebSocket` instead of `TCP`),
> `src/events/steam.events.ts` (plans 004 and 008), `src/utils/steam-error.ts`
> (created by plan 008). `src/index.ts` and `src/utils/retry.ts` must be
> unchanged. If `src/bot.ts` still says `EConnectionProtocol.TCP`, STOP: the
> maintainer's uncommitted WebSocket fix has not been committed yet.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/005-verification-baseline.md, plans/006-logger-errors-and-idempotent-token-delete.md, plans/008-token-policy-by-eresult.md
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
  this plan, a step, or "fix". This plan has exactly one justified comment (on
  the no-op `error` listener in Step 4); add no others.

## Why this matters

Every Steam `error` event is handled by two independent listeners that don't
know about each other:

1. `SteamEvents.onError` (permanent listener) logs, maybe deletes the token,
   then calls `bot.reconnect()`.
2. `Bot.start()` races `once(steam, "loggedOn")` against `once(steam, "error")`
   and rethrows the error to its caller.

Consequences, all reproducible from the code:

- **Crash on first login failure.** `src/index.ts` awaits `bot.start()` at top
  level. If the first login fails (wrong password, Steam down), `start()`
  rejects, the top-level `await` rejects and the process dies — while
  `onError` is concurrently deleting the token and starting its own
  `reconnect()` loop. With several accounts, one bad account kills all of them.
- **Concurrent reconnect loops.** During `reconnect()`, each failed `start()`
  emits another `error`, which triggers `onError` again, which starts *another*
  `reconnect()` while `withRetry` is still retrying the first. Loops multiply.
- **Leaked listeners.** `Promise.race` of two `once()` calls leaves the losing
  listener attached. Every successful login leaks one `error` listener, which
  later swallows a real error by turning it into an unhandled rejection.
- **One bad account ends the process.** `LogonSessionReplaced` and
  `InvalidPassword` call `process.exit(1)` from inside one bot's handler.

The maintainer chose: **a fatal error stops that bot only; the process exits
when no bots are left running.**

After this plan, `Bot.run()` is the single owner of a bot's lifecycle: log in
(with retries), wait for an error, handle it once, and either log in again or
stop. `SteamEvents` keeps only the non-error handlers.

## Current state

- `src/bot.ts` (whole file after plan 004):

  ```ts
  import type { Account } from "@/schema/account.schema";

  import { once } from "node:events";

  import Steam, { EConnectionProtocol } from "steam-user";

  import { SteamEvents } from "@/events/steam.events";
  import { TokenService } from "@/services/token.service";
  import { Logger } from "@/utils/logger";
  import { convertRelativePath } from "@/utils/path";
  import { withRetry } from "@/utils/retry";

  export class Bot {
    readonly logger: Logger;
    readonly steam: Steam;

    constructor(
      readonly account: Account,
      readonly tokens: TokenService,
      steamDataPath: string,
    ) {
      this.logger = new Logger(account.username.toLowerCase());

      this.steam = new Steam({
        autoRelogin: false,
        dataDirectory: convertRelativePath(steamDataPath),
        protocol: EConnectionProtocol.WebSocket,
      });

      new SteamEvents(this).bind();
    }

    async start(): Promise<void> {
      this.logger.log("Logging in...");
      this.steam.logOn(await this.getCredentials());

      await Promise.race([
        once(this.steam, "loggedOn"),
        once(this.steam, "error").then(([error]) => {
          throw error;
        }),
      ]);

      if (this.account.online) this.steam.setPersona(Steam.EPersonaState.Online);
    }

    async stop(): Promise<void> {
      if (!this.steam.steamID) return;
      this.steam.logOff();
      await once(this.steam, "disconnected");
    }

    syncGames(blocked: boolean): void {
      this.steam.gamesPlayed(blocked ? [] : [...this.account.games]);
      if (!blocked) this.logger.log(`Playing ${this.account.games.length} game(s)`);
    }

    async reconnect(): Promise<void> {
      try {
        await this.stop();
        await withRetry(() => this.start(), {
          attempts: 10,
          delayMs: 10_000,
          factor: 2,
          onRetry: (attempt, total, delay) =>
            this.logger.warn(`Retry ${attempt}/${total} in ${delay / 1_000}s...`),
        });
      } catch {
        this.logger.error("Failed to reconnect");
        this.steam.logOff();
      }
    }

    private async getCredentials(): Promise<Steam.LogOnDetailsRefresh | Steam.LogOnDetailsNamePass> {
      // ... unchanged by this plan ...
    }
  }
  ```

- `src/index.ts` (whole file):

  ```ts
  import { Bot } from "@/bot";
  import { config } from "@/config";
  import { TokenService } from "@/services/token.service";

  const tokens = new TokenService(config.tokens);

  const bots = await Promise.all(
    config.accounts.map(async (account) => {
      const bot = new Bot(account, tokens, config.steamData);
      await bot.start();
      return bot;
    }),
  );

  process.on("SIGINT", async () => {
    await Promise.all(bots.map((bot) => bot.stop()));
    process.exit(0);
  });
  ```

- `src/events/steam.events.ts` after plan 008: imports `Steam` as a value,
  `SteamError` and `invalidatesToken`; the `handlers` map has `error`,
  `playingState`, `steamGuard`, `refreshToken`; `onError(error: SteamError)`
  switches on `error.eresult` and ends with `await this.bot.reconnect();`.
- `src/utils/steam-error.ts` after plan 008: exports `SteamError` and
  `invalidatesToken`.
- `src/utils/retry.ts` (whole file): see plan 005; `withRetry(fn, { attempts, delayMs, factor, onRetry })`.
- steam-user facts this design relies on (v5.3.0):
  - an `error` event with **no** listener throws (Node `EventEmitter` rule), so
    at least one permanent `error` listener must exist.
  - after an `error`, the client is disconnected; `logOn()` may be called again.
  - `logOff()` emits `disconnected`.
  - `events.once(emitter, name, { signal })` removes its listener when the
    signal aborts; that is how the losing side of the race is cleaned up.
- Test conventions from plan 005: colocated `<name>.test.ts`, `bun:test`,
  `describe` per unit, present-tense test names.

## Commands you will need

| Purpose      | Command                 | Expected on success                          |
|--------------|-------------------------|----------------------------------------------|
| Typecheck    | `bun run typecheck`     | exit 0                                       |
| Tests        | `bun run test`          | `0 fail`                                     |
| Build        | `bun run build`         | `Built successfully`                         |
| Format check | `bun run format:check`  | `All matched files use the correct format.` |

Never run `bun run start` or `bun run dev` as a test: with a real `config.json`
and `.env` they log into Steam.

## Scope

**In scope**:
- `src/utils/retry.ts`, `src/utils/retry.test.ts`
- `src/utils/steam-error.ts`, `src/utils/steam-error.test.ts`
- `src/bot.ts`
- `src/bot.test.ts` (create)
- `src/index.ts`
- `src/events/steam.events.ts` (remove `error` handler, `onError` and the imports only it used)

**Out of scope**:
- `getCredentials`, `stop`, `syncGames` — unchanged.
- The Steam Guard handler (`onSteamGuard`), including its `process.exit(1)` on
  empty input — a known, separate issue.
- A login timeout — steam-user retries connections internally and the Steam
  Guard prompt can legitimately take minutes.
- The retry numbers (10 attempts, 10 s, factor 2) — keep them.

## Git workflow

- Branch: `advisor/009-single-owner-bot-lifecycle`
- Conventional commits, e.g. `feat(retry): add shouldRetry option`,
  `fix(bot): handle each steam error once and stop only the failing bot`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `shouldRetry` to `withRetry`

Add this test at the end of the `describe("withRetry", …)` block in
`src/utils/retry.test.ts`:

```ts
  test("stops when shouldRetry returns false", async () => {
    const fn = mock(async () => {
      throw new Error("fatal");
    });

    await expect(withRetry(fn, { ...options, shouldRetry: () => false })).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
```

Then change `src/utils/retry.ts` to:

```ts
interface RetryOptions {
  attempts: number;
  delayMs: number;
  factor: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, total: number, delay: number) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts, delayMs, factor, shouldRetry, onRetry }: RetryOptions,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts - 1 || shouldRetry?.(err) === false) throw err;

      const delay = delayMs * factor ** attempt;
      onRetry?.(attempt + 1, attempts, delay);
      await Bun.sleep(delay);
    }
  }
}
```

**Verify**: `bun test src/utils/retry.test.ts` → `5 pass`, `0 fail`.

### Step 2: Add `isFatal` to `src/utils/steam-error.ts`

Append:

```ts
export function isFatal({ eresult }: SteamError): boolean {
  return (
    eresult === Steam.EResult.InvalidPassword || eresult === Steam.EResult.LogonSessionReplaced
  );
}
```

In `src/utils/steam-error.test.ts`, change the import to
`import { invalidatesToken, isFatal } from "@/utils/steam-error";` and append:

```ts
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
```

**Verify**: `bun test src/utils/steam-error.test.ts` → `20 pass`, `0 fail`.

### Step 3: Write the lifecycle tests

Create `src/bot.test.ts`. It replaces `steam-user` with an in-memory fake, so
nothing touches the network or `./.steam`:

```ts
import type { TokenService } from "@/services/token.service";

import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";

class FakeSteam extends EventEmitter {
  static EResult = {
    Invalid: 0,
    Fail: 2,
    NoConnection: 3,
    InvalidPassword: 5,
    LoggedInElsewhere: 6,
    Busy: 10,
    AccessDenied: 15,
    Timeout: 16,
    ServiceUnavailable: 20,
    Revoked: 26,
    Expired: 27,
    LogonSessionReplaced: 34,
    TryAnotherCM: 48,
    RateLimitExceeded: 84,
  };
  static EPersonaState = { Online: 1 };
  static outcomes: (number | "ok")[] = [];

  steamID: object | null = null;
  logOnCalls = 0;

  logOn() {
    this.logOnCalls++;
    const outcome = FakeSteam.outcomes.shift() ?? "ok";
    setTimeout(() => {
      if (outcome !== "ok") return this.fail(outcome);
      this.steamID = {};
      this.emit("loggedOn");
    }, 0);
  }

  fail(eresult: number) {
    this.emit("error", Object.assign(new Error(`EResult ${eresult}`), { eresult }));
    this.steamID = null;
  }

  logOff() {
    this.steamID = null;
    setTimeout(() => this.emit("disconnected"), 0);
  }

  setPersona() {}
  gamesPlayed() {}
}

mock.module("steam-user", () => ({ default: FakeSteam, EConnectionProtocol: { WebSocket: 2 } }));
spyOn(console, "log").mockImplementation(() => {});

const { Bot } = await import("@/bot");

const account = { username: "alice", password: "secret", games: [730], online: false };
const del = mock(async () => {});
const tokens = { get: async () => undefined, set: async () => {}, del } as unknown as TokenService;

function createBot() {
  const bot = new Bot(account, tokens, "./.steam");
  return { bot, steam: bot.steam as unknown as FakeSteam };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for condition");
}

beforeEach(() => {
  FakeSteam.outcomes = [];
  del.mockClear();
});

describe("Bot.run", () => {
  test("logs in once", async () => {
    const { bot, steam } = createBot();
    bot.run();

    await waitFor(() => steam.steamID !== null);
    expect(steam.logOnCalls).toBe(1);
  });

  test("stops without retrying on a fatal login error", async () => {
    FakeSteam.outcomes = [FakeSteam.EResult.InvalidPassword];
    const { bot, steam } = createBot();

    await bot.run();

    expect(steam.logOnCalls).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  test("logs in again after a dropped connection and keeps the token", async () => {
    const { bot, steam } = createBot();
    bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.NoConnection);

    await waitFor(() => steam.logOnCalls === 2 && steam.steamID !== null);
    expect(del).not.toHaveBeenCalled();
  });

  test("deletes the token once when it is rejected after login", async () => {
    const { bot, steam } = createBot();
    bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.AccessDenied);

    await waitFor(() => steam.logOnCalls === 2 && steam.steamID !== null);
    expect(del).toHaveBeenCalledTimes(1);
  });

  test("stops and keeps the token when the session is replaced", async () => {
    const { bot, steam } = createBot();
    const running = bot.run();
    await waitFor(() => steam.steamID !== null);

    steam.fail(FakeSteam.EResult.LogonSessionReplaced);

    await running;
    expect(steam.logOnCalls).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });
});
```

Notes for the executor:
- `bot.run()` without `await` in some tests is intentional: those bots keep
  running (logged in) after the test; the fake never emits by itself.
- Why the test file mocks `console.log`: running bots log in the background.

**Verify**: `bun run typecheck` → errors about `run` not existing on `Bot`
(expected — `run` is added next). `bun test src/bot.test.ts` → fails.

### Step 4: Rewrite the lifecycle in `src/bot.ts`

1. Imports become:

   ```ts
   import type { Account } from "@/schema/account.schema";
   import type { SteamError } from "@/utils/steam-error";

   import { once } from "node:events";

   import Steam, { EConnectionProtocol } from "steam-user";

   import { SteamEvents } from "@/events/steam.events";
   import { TokenService } from "@/services/token.service";
   import { Logger } from "@/utils/logger";
   import { convertRelativePath } from "@/utils/path";
   import { withRetry } from "@/utils/retry";
   import { invalidatesToken, isFatal } from "@/utils/steam-error";
   ```

2. In the constructor, insert these two lines between the `this.steam = new Steam({ … });`
   statement and `new SteamEvents(this).bind();` (separated by blank lines like
   the surrounding code). This is the only comment in the plan:

   ```ts
       // steam-user throws on unhandled "error" events; run() and logOn() consume them with once().
       this.steam.on("error", () => {});
   ```

3. Replace `start()` and `reconnect()` with `run()` (public, placed where
   `start()` was, before `stop()`), and add the private `logOn()` and
   `handleError()` after `syncGames()` and before `getCredentials()`:

   ```ts
     async run(): Promise<void> {
       for (;;) {
         try {
           await withRetry(() => this.logOn(), {
             attempts: 10,
             delayMs: 10_000,
             factor: 2,
             shouldRetry: (error) => !isFatal(error as SteamError),
             onRetry: (attempt, total, delay) =>
               this.logger.warn(`Retry ${attempt}/${total} in ${delay / 1_000}s...`),
           });
         } catch {
           this.logger.error("Stopped");
           return;
         }

         const [error] = await once(this.steam, "error");
         await this.handleError(error);
         if (isFatal(error)) {
           this.logger.error("Stopped");
           return;
         }
       }
     }
   ```

   ```ts
     private async logOn(): Promise<void> {
       this.logger.log("Logging in...");
       this.steam.logOn(await this.getCredentials());

       const controller = new AbortController();
       const { signal } = controller;

       try {
         await Promise.race([
           once(this.steam, "loggedOn", { signal }),
           once(this.steam, "error", { signal }).then(async ([error]) => {
             await this.handleError(error);
             throw error;
           }),
         ]);
       } finally {
         controller.abort();
       }

       if (this.account.online) this.steam.setPersona(Steam.EPersonaState.Online);
     }

     private async handleError(error: SteamError): Promise<void> {
       switch (error.eresult) {
         case Steam.EResult.LogonSessionReplaced:
           this.logger.error("Session replaced");
           break;
         case Steam.EResult.InvalidPassword:
           this.logger.error("Invalid credentials");
           break;
         case Steam.EResult.LoggedInElsewhere:
           this.logger.warn("Logged in elsewhere");
           break;
         case Steam.EResult.NoConnection:
           this.logger.error("Connection dropped");
           break;
         default:
           this.logger.error(error.message);
       }

       if (invalidatesToken(error)) await this.tokens.del(this.account.username);
     }
   ```

   Log messages and levels are exactly those of the old `onError`; only the
   `process.exit` calls and `reconnect()` are gone. `InvalidPassword` still
   deletes the token (through `invalidatesToken`); `LogonSessionReplaced` keeps it.

   Why each piece exists (for review, not for comments in the code):
   - `controller.abort()` in `finally` removes whichever `once` listener lost
     the race. Without it, the next error is handled twice (the "deletes the
     token once" test catches this).
   - `shouldRetry` stops retrying on `InvalidPassword` (the "fatal login
     error" test catches this).
   - `withRetry` exhausting its attempts also ends in `"Stopped"`.

**Verify**: `bun run typecheck` → errors only in `src/index.ts` and
`src/events/steam.events.ts` (they still call `start`/`reconnect`).

### Step 5: Remove error handling from `SteamEvents`

In `src/events/steam.events.ts`:
- delete the `error: this.onError.bind(this),` entry from `handlers`;
- delete the whole `onError` method;
- imports become:

  ```ts
  import type { Bot } from "@/bot";
  import type Steam from "steam-user";

  import { withStdinLock } from "@/utils/stdin-lock";
  ```

Nothing else in the file changes.

**Verify**: `grep -c "onError\|steam-error\|reconnect" src/events/steam.events.ts` → `0`

### Step 6: Run bots independently in `src/index.ts`

Replace the whole file with:

```ts
import { Bot } from "@/bot";
import { config } from "@/config";
import { TokenService } from "@/services/token.service";

const tokens = new TokenService(config.tokens);
const bots = config.accounts.map((account) => new Bot(account, tokens, config.steamData));

process.on("SIGINT", async () => {
  await Promise.all(bots.map((bot) => bot.stop()));
  process.exit(0);
});

await Promise.all(bots.map((bot) => bot.run()));
process.exit(1);
```

`run()` only returns when that bot stopped for good, so reaching the last line
means every bot has stopped: exit with an error code. SIGINT is now registered
before any login starts, so Ctrl+C works during the first login too.

**Verify**:
- `bun run typecheck` → exit 0
- `bun test src/bot.test.ts` → `5 pass`, `0 fail`

### Step 7: Run all gates

**Verify**:
- `bun run test` → `45 pass`, `0 fail`
- Run `bun run test` two more times → `45 pass` each time (no flakiness)
- `bun run format:check` → passes (run `bun run format` once if it doesn't)
- `bun run build` → `Built successfully`
- `grep -rn "process.exit" src --include=*.ts | grep -v test` → only
  `src/index.ts` (2 matches) and the Steam Guard handler in
  `src/events/steam.events.ts` (2 matches)

## Test plan

- `src/bot.test.ts` (new, 5 tests) with a `FakeSteam` via `mock.module`:
  happy path, fatal login error (no retry, token deleted), dropped connection
  (relogin, token kept), token rejected after login (deleted exactly once),
  session replaced (stops, token kept).
- `src/utils/retry.test.ts` (+1): `shouldRetry` returning false stops immediately.
- `src/utils/steam-error.test.ts` (+5): `isFatal`.
- Mutation check (optional, do not commit): delete `controller.abort();` →
  the "deletes the token once" test fails; delete the `shouldRetry` line → the
  "fatal login error" test fails. Restore both.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` reports `45 pass`, `0 fail` on three consecutive runs
- [ ] `grep -c "reconnect\|start()" src/bot.ts src/index.ts` → `0` for both files
- [ ] `grep -c "//" src/bot.ts` → `1`
- [ ] `bun run build` succeeds
- [ ] `git diff --stat main...HEAD` lists only the eight in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- The fake in `bot.test.ts` needs an API that `Bot` calls but the fake lacks
  (e.g. `Bot` uses a new steam-user method) — report it; don't extend the fake
  beyond what `Bot` calls.
- Any `bot.test.ts` test fails intermittently across the three runs in Step 7.
- Typecheck rejects `once(this.steam, "error")` destructuring as `SteamError`
  (different `@types/steam-user` or `@types/node` version) and a plain
  annotation doesn't fix it.
- You feel the need to add a timeout, a max-relogin counter, or a
  `process.exit` in `Bot` — none were requested.

## Maintenance notes

- **Behavior changes users will notice**: the first login now retries like
  reconnects do (previously a failure crashed the process); one account's
  fatal error no longer stops the others; the process exits with code 1 once
  every bot has stopped.
- `run()` is the only place that decides "relogin or stop". New error kinds go
  into `handleError` (logging) and `steam-error.ts` (policy), with a test in
  `steam-error.test.ts`.
- The no-op `error` listener must stay: without it an `error` emitted while
  neither `once` is waiting (e.g. between `handleError` and the next `logOn`)
  would crash the process.
- `SteamEvents` handlers must not react to `error`; if one is added there
  again, errors will be handled twice.
