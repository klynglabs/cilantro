# Plan 005: Add `typecheck` and `test` scripts with a first unit-test suite

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- src/utils/retry.ts src/utils/stdin-lock.ts src/services/token.service.ts CONTRIBUTING.md package.json`
> Plan 004 must be DONE first; its changes to `package.json` (oxfmt, oxlint,
> `format:check`, `lint`) are expected, as is a change to the `build`/`compile`
> scripts. Any change to the three `src/` files means the excerpts below may be
> stale: compare them with the live code and STOP on a mismatch.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-align-formatter-with-code.md
- **Category**: tests
- **Planned at**: commit `56ffc99`, 2026-09-28

## Project rules (apply to every change in this plan)

- Read `CLAUDE.md` in the repo root before starting and follow it throughout:
  think before coding (state assumptions, stop and ask when unclear),
  simplicity first (minimum code, nothing speculative), surgical changes
  (every changed line traces to this plan), goal-driven execution (every step
  has a verify command; loop until it passes).
- No useless comments. Add a comment only when the code cannot explain itself
  (a non-obvious *why*). Never restate what the code does and never mention
  this plan, a step, or "fix". The test files below need no comments.

## Why this matters

The repo has no tests, no `typecheck` script and no CI, so the only way to know
a change works is to log into Steam by hand. Plans 006–009 change error handling
and the bot lifecycle; they need a fast, automated gate. This plan adds
`bun run typecheck` and `bun run test`, and characterization tests for the three
pure units (`withRetry`, `withStdinLock`, `TokenService`) so later plans have a
pattern to copy and a baseline that must stay green.

## Current state

- `package.json` scripts after plan 004:
  `dev`, `build`, `compile`, `start`, `format`, `format:check`, `lint`. No `typecheck`, no `test`.
  `typescript` is already a devDependency; `bun test` is built into Bun (v1.4.2).
- `tsconfig.json` includes `**/*.ts`, so `*.test.ts` files are typechecked too.
  Path alias `@/*` → `./src/*` works in tests.
- `src/utils/retry.ts` (whole file):

  ```ts
  interface RetryOptions {
    attempts: number;
    delayMs: number;
    factor: number;
    onRetry?: (attempt: number, total: number, delay: number) => void;
  }

  export async function withRetry<T>(
    fn: () => Promise<T>,
    { attempts, delayMs, factor, onRetry }: RetryOptions,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= attempts - 1) throw err;

        const delay = delayMs * factor ** attempt;
        onRetry?.(attempt + 1, attempts, delay);
        await Bun.sleep(delay);
      }
    }
  }
  ```

- `src/utils/stdin-lock.ts` (whole file): a module-level promise chain;
  `withStdinLock(fn)` runs `fn` after every previously queued call settles and
  swallows rejections in the chain so one failure doesn't block the queue.
- `src/services/token.service.ts`: `new TokenService(dir)` creates `dir`;
  `get(username)` reads `<dir>/<encodeURIComponent(username)>`, trims it and
  returns `undefined` when missing or empty; `set` writes; `del` deletes.
- `CONTRIBUTING.md` "Before Submitting" section currently reads:

  ````md
  ## Before Submitting

  Format your code:

  ```bash
  bun run format
  ```
  ````

- Test file convention (new): colocated `<name>.test.ts` next to the source
  file, imports from `bun:test`, `describe` per unit, `test` names in plain
  present tense.

## Commands you will need

| Purpose      | Command                 | Expected on success                          |
|--------------|-------------------------|----------------------------------------------|
| Typecheck    | `bun run typecheck`     | exit 0, no output                            |
| Tests        | `bun run test`          | `0 fail`                                     |
| Format check | `bun run format:check`  | `All matched files use the correct format.` |

## Scope

**In scope**:
- `package.json` (scripts only)
- `src/utils/retry.test.ts` (create)
- `src/utils/stdin-lock.test.ts` (create)
- `src/services/token.service.test.ts` (create)
- `CONTRIBUTING.md` ("Before Submitting" section only)

**Out of scope**:
- Any change to `src/**/*.ts` that is not a `*.test.ts` file. If a test fails
  against the current code, that's a finding — STOP, don't "fix" the source.
- A test for deleting a missing token — current behavior throws; plan 006 fixes and tests it.
- CI configuration — not requested.

## Git workflow

- Branch: `advisor/005-verification-baseline`
- Conventional commits, e.g. `test: add unit tests for retry, stdin lock and token service`,
  `chore: add typecheck and test scripts`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the scripts

In `package.json` `scripts`, add after `lint`:

```json
"typecheck": "tsc --noEmit",
"test": "bun test"
```

**Verify**: `bun run typecheck` → exit 0. `bun run test` → prints
`error: 0 test files matching …` (no tests yet) — expected at this step.

### Step 2: Create `src/utils/retry.test.ts`

```ts
import { describe, expect, mock, test } from "bun:test";

import { withRetry } from "@/utils/retry";

const options = { attempts: 3, delayMs: 1, factor: 2 };

describe("withRetry", () => {
  test("returns the first successful result", async () => {
    const fn = mock(async () => "ok");

    expect(await withRetry(fn, options)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("retries until success", async () => {
    let calls = 0;
    const fn = mock(async () => {
      if (++calls < 3) throw new Error("fail");
      return "ok";
    });

    expect(await withRetry(fn, options)).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("throws the last error after all attempts", async () => {
    const fn = mock(async () => {
      throw new Error("fail");
    });

    await expect(withRetry(fn, options)).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("reports each retry with an exponential delay", async () => {
    const onRetry = mock((_attempt: number, _total: number, _delay: number) => {});
    const fn = async () => {
      throw new Error("fail");
    };

    await expect(withRetry(fn, { ...options, onRetry })).rejects.toThrow();
    expect(onRetry.mock.calls).toEqual([
      [1, 3, 1],
      [2, 3, 2],
    ]);
  });
});
```

The typed parameters on the `onRetry` mock are required: with `mock(() => {})`
`tsc` rejects the `toEqual` argument.

**Verify**: `bun test src/utils/retry.test.ts` → `4 pass`, `0 fail`.

### Step 3: Create `src/utils/stdin-lock.test.ts`

```ts
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
```

**Verify**: `bun test src/utils/stdin-lock.test.ts` → `2 pass`, `0 fail`.

### Step 4: Create `src/services/token.service.test.ts`

Each test gets its own temporary directory, so nothing touches the real
`./.tokens` folder.

```ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

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
```

**Verify**: `bun test src/services/token.service.test.ts` → `5 pass`, `0 fail`.

### Step 5: Update `CONTRIBUTING.md`

Replace the body of the "Before Submitting" section (keep the heading) with:

````md
Format, lint, typecheck and test your code:

```bash
bun run format
bun run lint
bun run typecheck
bun run test
```
````

**Verify**: `grep -c "bun run typecheck" CONTRIBUTING.md` → `1`

### Step 6: Run all gates

**Verify**:
- `bun run typecheck` → exit 0
- `bun run test` → `11 pass`, `0 fail`
- `bun run format:check` → `All matched files use the correct format.`
  (if it fails, run `bun run format` — it only reorders imports / wraps lines — and re-check)

## Test plan

This plan is the test plan: 11 tests across 3 new files, listed in Steps 2–4.
They characterize current behavior; all must pass against unchanged source.

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `bun run test` reports `11 pass` and `0 fail`
- [ ] `bun run format:check` passes
- [ ] `git diff --stat main...HEAD -- src` lists only the three new `*.test.ts` files
- [ ] `CONTRIBUTING.md` mentions `bun run typecheck` and `bun run test`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any test in Steps 2–4 fails against the unchanged source (the plan's
  understanding of the code is wrong — report which assertion failed).
- `bun run test` touches or creates anything under the repo's `.tokens/` directory.
- `tsc` reports errors in files you did not create.

## Maintenance notes

- New tests go next to their source file as `<name>.test.ts`; `bun test`
  discovers them automatically.
- Tests that need filesystem state must use a `mkdtempSync` directory like
  `token.service.test.ts`, never the real `./.tokens` or `./.steam`.
- Adding a CI workflow that runs `format:check`, `typecheck` and `test` is a
  natural follow-up; it was not requested.
