# Plan 002: Fix Steam Guard stdin — serialize multi-account reads and handle closed stdin

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e868f9..HEAD -- src/events/steam.events.ts src/utils/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-delete-stale-token-on-auth-error.md
- **Category**: bug
- **Planned at**: commit `9e868f9`, 2026-06-15

## Why this matters

This plan fixes two bugs in `onSteamGuard` that both affect the same function.
They are bundled here because they modify the same code; apply them together.

**Bug A — Multi-account stdin contention**: The app advertises multi-account
support but `onSteamGuard` uses `for await (const line of console)` — a single
shared stdin stream. If two accounts both need a Steam Guard code on first login,
both handlers start consuming from the same iterator concurrently. One handler
gets the first line of input; the other gets the next line (a wrong code) or
never fires its callback at all, leaving that account's login permanently stuck.

**Bug B — Silent hang on closed stdin**: If the process is run non-interactively
(piped stdin, backgrounded, PM2, Docker), stdin is already closed when
`onSteamGuard` fires. The `for await` loop exits immediately without entering its
body, so `callback` is never called, and steam-user waits forever for a code that
will never arrive. No timeout fires, no error is logged after the initial prompt.

**Fix strategy**:
- For Bug A: introduce a module-level promise queue (mutex) in a new utility
  file `src/utils/stdin-lock.ts`. All `onSteamGuard` calls acquire the lock
  before reading stdin, so at most one prompt is active at a time. When a second
  account needs a code, it waits until the first account's prompt is resolved,
  then prints its own prompt.
- For Bug B: track whether the `for await` loop body ever executed. If the loop
  exits without providing a code, log a clear error and exit.

## Current state

**`src/events/steam.events.ts` — onSteamGuard (lines 63–75)**

```ts
private async onSteamGuard(
  _domain: string | null,
  callback: (code: string) => void,
): Promise<void> {
  this.bot.logger.warn("Enter Steam Guard code");

  for await (const line of console) {
    const code = line?.trim();
    if (!code) process.exit(1);
    callback(code);
    break;
  }
}
```

**Existing utils files for convention reference** — `src/utils/` contains:
- `logger.ts` — class export
- `path.ts` — named function export: `export function convertRelativePath(...)`
- `retry.ts` — named function export: `export async function withRetry(...)`
- `resolve-env.ts` — named function export: `export function resolveEnv(...)`

New utility files follow the same pattern: named exports, no default export,
no class wrapper unless state is needed.

**`src/events/steam.events.ts` imports** (lines 1–10)

```ts
import type Steam from "steam-user";

import type { Bot } from "@/bot";

type EventHandler<K extends keyof Steam.Events> = (
  ...args: Steam.Events[K]
) => void | Promise<void>;

type EventHandlerMap = { [K in keyof Steam.Events]?: EventHandler<K> };
```

The path alias `@/` maps to `./src/` (see `tsconfig.json`).

## Commands you will need

| Purpose    | Command            | Expected on success      |
|------------|--------------------|--------------------------|
| Typecheck  | `bun tsc --noEmit` | exits 0, no output       |

## Scope

**In scope** (the only files you should create or modify):
- `src/utils/stdin-lock.ts` — create new
- `src/events/steam.events.ts` — modify `onSteamGuard` only

**Out of scope** (do NOT touch):
- Any other handler in `SteamEvents` (`onError`, `onPlayingState`, `onRefreshToken`)
- `src/bot.ts`, `src/index.ts`, any schema or config file
- Do NOT add the lock to the `bind()` method or any other call site — only
  `onSteamGuard` reads from stdin

## Git workflow

- Branch: `advisor/002-steam-guard-stdin`
- Conventional Commits style (matches repo history): `fix(bot): serialize steam guard stdin reads`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create `src/utils/stdin-lock.ts`

Create a new file `src/utils/stdin-lock.ts` with this exact content:

```ts
let queue = Promise.resolve();

export function withStdinLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}
```

How it works: `queue` is a module-level promise chain. Each caller appends its
work to the chain via `.then(fn)`. The chain advances serially — the next caller
can only start after the current one resolves or rejects. The `queue` assignment
always resolves (both branches are no-ops) so a failed prompt doesn't block
subsequent ones.

**Verify**: `bun tsc --noEmit` → exits 0. Confirm the file exists:
`ls src/utils/stdin-lock.ts` → file present.

### Step 2: Update `onSteamGuard` in `src/events/steam.events.ts`

Add the import at the top of the file, after the existing imports. The existing
import block ends at line 9. Add:

```ts
import { withStdinLock } from "@/utils/stdin-lock";
```

Then replace the `onSteamGuard` method (currently lines 63–75) with:

```ts
private async onSteamGuard(
  _domain: string | null,
  callback: (code: string) => void,
): Promise<void> {
  await withStdinLock(async () => {
    this.bot.logger.warn("Enter Steam Guard code");

    let provided = false;
    for await (const line of console) {
      const code = line?.trim();
      if (!code) process.exit(1);
      callback(code);
      provided = true;
      break;
    }

    if (!provided) {
      this.bot.logger.error("Steam Guard: stdin is closed, cannot read code");
      process.exit(1);
    }
  });
}
```

Changes from the original:
1. The entire body is wrapped in `withStdinLock(async () => { ... })` — serializes concurrent calls.
2. `let provided = false` / `provided = true` — tracks whether the loop body ran.
3. `if (!provided)` block after the loop — handles closed stdin (Bug B fix).

The `callback` call and the `if (!code) process.exit(1)` guard are unchanged.

**Verify**: `bun tsc --noEmit` → exits 0, no errors.

### Step 3: Confirm no other stdin reads exist

```
grep -rn "for await.*console\|process.stdin\|readline" src/
```

Expected: the only match is the one you just wrote in `steam.events.ts`.
If any other file reads stdin, STOP — this plan doesn't cover those.

## Test plan

No automated test infrastructure exists. Manual verification:

1. **Single account, normal interactive run**: start with a fresh account (no
   stored token). Enter Steam Guard code when prompted. Confirm login succeeds
   and a token file appears in `.tokens/`.

2. **Closed stdin**: run `echo "" | bun run dev` (pipes closed stdin). Confirm
   that after "Enter Steam Guard code" is printed, the process logs
   "Steam Guard: stdin is closed, cannot read code" and exits with code 1,
   rather than hanging indefinitely.

3. **Multi-account serialization** (if you have two test accounts): configure
   two accounts in `config.json`, both without stored tokens. On first run,
   confirm:
   - Only one "Enter Steam Guard code" prompt appears at a time.
   - After entering the first code and that account logs in, the second prompt
     appears.
   - Both accounts end up logged in.

## Done criteria

- [ ] `bun tsc --noEmit` exits 0
- [ ] `src/utils/stdin-lock.ts` exists and exports `withStdinLock`
- [ ] `onSteamGuard` in `src/events/steam.events.ts` is wrapped in `withStdinLock`
- [ ] `onSteamGuard` logs an error and calls `process.exit(1)` when `provided` is false
- [ ] `grep -rn "withStdinLock" src/` → exactly two matches (definition + import+call)
- [ ] No files outside the in-scope list are modified (`git diff --name-only`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The code at `steam.events.ts:63-75` doesn't match the excerpt in "Current state."
- `bun tsc --noEmit` fails after either step.
- You find that another file in `src/` also reads from stdin — report it rather
  than extending the lock to cover it (out of scope for this plan).
- The `for await (const line of console)` pattern behaves differently than
  described (e.g., Bun's implementation throws rather than silently exiting the
  loop on closed stdin) — report the actual behavior so the fix can be adjusted.

## Maintenance notes

- The module-level `queue` in `stdin-lock.ts` is global to the process, which
  is correct: there is only one stdin. Do not instantiate `withStdinLock` per-bot.
- If a future version of the app adds other stdin reads (e.g., an interactive
  command prompt), those should also use `withStdinLock` to avoid contention.
- The `provided` pattern detects a closed-stdin loop exit. If Bun changes the
  behavior of `for await (const line of console)` when stdin is closed (e.g.,
  to throw instead of silently exit), this check may need updating.
