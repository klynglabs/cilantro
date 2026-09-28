# Plan 006: Log Errors with their stack, and make deleting a missing token a no-op

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- src/utils/logger.ts src/services/token.service.ts`
> Expected: no output. Plans 004 and 005 must be DONE (they add
> `src/services/token.service.test.ts`, which this plan extends). If either
> in-scope source file changed, compare with the excerpts below and STOP on a mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/005-verification-baseline.md
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
  this plan, a step, or "fix". Nothing in this plan needs a comment.

## Why this matters

Two small bugs combine into a silent failure:

1. `format()` in `src/utils/logger.ts` passes objects to `JSON.stringify`.
   `Error` properties are non-enumerable, so every logged Error prints as `{}`.
   The one place that logs an Error — the catch-all in
   `src/events/steam.events.ts` (`Unhandled error in '<event>' event`) — shows
   nothing useful.
2. `TokenService.del` uses `Bun.file(path).delete()`, which throws `ENOENT`
   when no token file exists. That is the normal state for a first-time login
   with username/password. When Steam rejects the password, `onError` awaits
   `tokens.del(...)`, which throws before `process.exit(1)` runs. The rejection
   is caught by the catch-all and logged as `{}`, and the process keeps running
   with a dead bot and no explanation.

After this plan, deleting a missing token succeeds, and any logged Error shows
its message and stack.

## Current state

- `src/utils/logger.ts:34-42`:

  ```ts
  function format(value: unknown): string {
    if (value == null) return String(value);
    if (typeof value !== "object") return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "[Circular]";
    }
  }
  ```

  `Logger.print` maps every argument through `format`, joins them with spaces
  and writes one line with `console.log`: `[Cilantro] <time> <LEVEL> [<context>] <text>`.

- `src/services/token.service.ts` (imports and `del`):

  ```ts
  import { mkdirSync } from "node:fs";
  import { join } from "node:path";

  import { convertRelativePath } from "@/utils/path";
  ...
    async del(username: string): Promise<void> {
      await Bun.file(this.path(username)).delete();
    }
  ```

- `src/services/token.service.test.ts` exists (from plan 005) with a
  `describe("TokenService", …)` block, a `mkdtempSync` directory per test and
  a `tokens` variable. Follow it as the pattern.

## Commands you will need

| Purpose      | Command                 | Expected on success                          |
|--------------|-------------------------|----------------------------------------------|
| Typecheck    | `bun run typecheck`     | exit 0                                       |
| Tests        | `bun run test`          | `0 fail`                                     |
| Format check | `bun run format:check`  | `All matched files use the correct format.` |

## Scope

**In scope**:
- `src/utils/logger.ts` (`format` only)
- `src/utils/logger.test.ts` (create)
- `src/services/token.service.ts` (`del` and one import)
- `src/services/token.service.test.ts` (add one test)

**Out of scope**:
- `src/events/steam.events.ts` — its error handling is reworked by plans 008 and 009.
- The logger's colors, layout or level names.

## Git workflow

- Branch: `advisor/006-logger-errors-and-idempotent-token-delete`
- Conventional commits, e.g. `fix(logger): print errors with their stack`,
  `fix(tokens): ignore missing token file on delete`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the failing logger test

Create `src/utils/logger.test.ts`:

```ts
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
```

`lastCall` (not `calls[0]`) is deliberate: other test files may leave bots
running that log in the background while this file runs.

**Verify**: `bun test src/utils/logger.test.ts` → `2 pass`, `1 fail`; the
failing test is `Logger > prints an Error's stack`.

### Step 2: Format Errors in `format()`

Add one line at the top of `format` in `src/utils/logger.ts`:

```ts
function format(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (value == null) return String(value);
  ...
```

**Verify**: `bun test src/utils/logger.test.ts` → `3 pass`, `0 fail`.

### Step 3: Write the failing token test

Add this test at the end of the `describe("TokenService", …)` block in
`src/services/token.service.test.ts`:

```ts
  test("deleting a missing token does not throw", async () => {
    await expect(tokens.del("alice")).resolves.toBeUndefined();
  });
```

**Verify**: `bun test src/services/token.service.test.ts` → `5 pass`, `1 fail`
(`deleting a missing token does not throw`, ENOENT).

### Step 4: Make `del` idempotent

In `src/services/token.service.ts`, import `rm` and use it with `force: true`:

```ts
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
```

```ts
  async del(username: string): Promise<void> {
    await rm(this.path(username), { force: true });
  }
```

**Verify**: `bun test src/services/token.service.test.ts` → `6 pass`, `0 fail`.

### Step 5: Run all gates

**Verify**:
- `bun run typecheck` → exit 0
- `bun run test` → `15 pass`, `0 fail`
- `bun run format:check` → passes (run `bun run format` once if it doesn't)

## Test plan

- `src/utils/logger.test.ts` (new, 3 tests): line layout, Error stack (the
  regression), plain-object JSON (unchanged behavior).
- `src/services/token.service.test.ts` (+1 test): deleting a missing token.
- Both new regression tests must fail before their fix (Steps 1 and 3) and pass after.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` reports `15 pass`, `0 fail`
- [ ] `grep -n "instanceof Error" src/utils/logger.ts` → one match inside `format`
- [ ] `grep -n "\.delete()" src/services/token.service.ts` → no matches
- [ ] `git diff --stat main...HEAD` lists only the four in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1 or Step 3 does not fail the way described (the bug may already be fixed; report it).
- `Bun.stripANSI` is not a function in the installed Bun (`bun --version` below 1.2) — report instead of writing an ANSI regex.
- Any other test file starts failing.

## Maintenance notes

- `format` now prints the full stack for Errors. If logs get too noisy, change
  it to `value.message` rather than removing the Error branch.
- `del` is safe to call unconditionally; callers must not add `exists()` checks around it.
