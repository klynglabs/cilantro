# Plan 007: Read `config.json` at runtime instead of bundling it into the build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- src/config.ts src/schema/ src/utils/resolve-env.ts`
> Expected: only `src/config.ts`, with an import-order change from plan 004
> (`import configFile from "../config.json";` moved to the top). Plan 005 must
> be DONE. Any other change: compare with the excerpts below and STOP on a mismatch.

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

`src/config.ts` does `import configFile from "../config.json"`. `bun build`
inlines that JSON into `build/index.js` and into `cilantro.exe` (you can find
`steamData:"./.steam"` in the minified output). So:

- editing `config.json` has no effect on `bun run start` until you rebuild;
- the compiled exe can never be reconfigured, and the account list of whoever
  built it ships inside the binary;
- building fails outright if `config.json` doesn't exist (it's gitignored).

Also, `accounts: []` passes validation (`if (!configFile.accounts)` only catches
a missing key), and the process then exits silently doing nothing.

After this plan, the config is read from `config.json` in the current working
directory at startup, the same way `steamData`, `tokens` and Bun's `.env`
loading already resolve relative to the working directory. A missing file or an
empty account list fails with a clear message.

## Current state

- `src/config.ts` (whole file, after plan 004's import reorder):

  ```ts
  import configFile from "../config.json";

  import { ConfigSchema } from "@/schema/config.schema";
  import { resolveEnv } from "@/utils/resolve-env";

  if (!configFile.accounts) {
    throw new Error("No accounts found in config file");
  }

  export const config = ConfigSchema.parse({
    accounts: configFile.accounts.map((account) => ({
      ...account,
      username: resolveEnv(account.username),
      password: resolveEnv(account.password),
    })),
    steamData: configFile.steamData,
    tokens: configFile.tokens,
  });
  ```

- `src/schema/account.schema.ts` (whole file):

  ```ts
  import { z } from "zod";

  export const AccountSchema = z.object({
    username: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.@]+$/),
    password: z.string().min(1),
    games: z.array(z.number().int().positive()).min(1).max(32),
    online: z.boolean().default(false),
  });

  export type Account = z.infer<typeof AccountSchema>;
  ```

- `src/schema/config.schema.ts`:

  ```ts
  export const ConfigSchema = z.object({
    accounts: z.array(AccountSchema),
    steamData: z.string(),
    tokens: z.string(),
  });
  ```

- `src/utils/resolve-env.ts`: `resolveEnv(key)` returns `Bun.env[key]` or throws
  `Missing required environment variable: <key>`.
- `src/utils/path.ts`: `convertRelativePath(path)` = `resolve(path)` (relative to cwd).
- `config.example.json`: `username`/`password` hold **names of environment
  variables** (e.g. `STEAM_ACCOUNT_USERNAME`), not the credentials. Keep it that way.
- zod version: `^3.25.76` (zod 3 API: `.transform`, `.pipe`).

Why the env lookup moves into the schema: the file is now `unknown` JSON, so
`configFile.accounts.map(...)` can no longer run before validation. A zod
`transform` resolves each name after its shape has been checked.

## Commands you will need

| Purpose      | Command                 | Expected on success                          |
|--------------|-------------------------|----------------------------------------------|
| Typecheck    | `bun run typecheck`     | exit 0                                       |
| Tests        | `bun run test`          | `0 fail`                                     |
| Build        | `bun run build`         | `Built successfully`                         |
| Format check | `bun run format:check`  | `All matched files use Prettier code style!` |

## Scope

**In scope**:
- `src/config.ts`
- `src/schema/account.schema.ts`
- `src/schema/config.schema.ts`
- `src/schema/config.schema.test.ts` (create)

**Out of scope**:
- `config.example.json`, `README.md` — the documented setup (copy the example
  to `config.json` in the project folder) stays correct.
- `scripts/build.ts`, `scripts/compile.ts`.
- `src/index.ts`, `src/bot.ts`.
- Supporting literal values alongside env-var names — not requested.

## Git workflow

- Branch: `advisor/007-load-config-at-runtime`
- Conventional commit, e.g. `fix(config): load config.json at runtime`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the schema tests

Create `src/schema/config.schema.test.ts`:

```ts
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
```

**Verify**: `bun test src/schema/config.schema.test.ts` → `0 pass`, `4 fail`
(today the schema neither resolves env vars nor rejects an empty list).

### Step 2: Resolve env vars inside `AccountSchema`

Replace `src/schema/account.schema.ts` with:

```ts
import { z } from "zod";

import { resolveEnv } from "@/utils/resolve-env";

const envVar = z.string().min(1).transform(resolveEnv);

export const AccountSchema = z.object({
  username: envVar.pipe(z.string().regex(/^[a-zA-Z0-9_.@]+$/)),
  password: envVar,
  games: z.array(z.number().int().positive()).min(1).max(32),
  online: z.boolean().default(false),
});

export type Account = z.infer<typeof AccountSchema>;
```

The username regex now runs on the resolved value (the real account name), not
on the variable name.

### Step 3: Require at least one account

In `src/schema/config.schema.ts` change the `accounts` line to:

```ts
  accounts: z.array(AccountSchema).min(1, "No accounts found in config file"),
```

**Verify**: `bun test src/schema/config.schema.test.ts` → `4 pass`, `0 fail`.

### Step 4: Load the file at runtime

Replace `src/config.ts` with:

```ts
import { ConfigSchema } from "@/schema/config.schema";
import { convertRelativePath } from "@/utils/path";

const path = convertRelativePath("config.json");
const file = Bun.file(path);

if (!(await file.exists())) {
  throw new Error(`Config file not found: ${path}. Copy config.example.json to config.json.`);
}

export const config = ConfigSchema.parse(await file.json());
```

**Verify**:
- `bun run typecheck` → exit 0
- `bun run build` → `Built successfully`
- `grep -c "Config file not found" build/index.js` → `1`
- `grep -Ec 'steamData:"|"steamData":"' build/index.js` → `0` (config no longer inlined)

### Step 5: Smoke-test the missing-file message

From a temporary empty directory, start the app from source (bash):

```bash
cd "$(mktemp -d)" && bun "$OLDPWD/src/index.ts"; cd "$OLDPWD"
```

**Verify**: output contains `Error: Config file not found:` followed by a path
ending in `config.json`. Nothing is created in the temp directory.

Do **not** run `bun run start`/`dev` from the repo root as a test — with a real
`config.json` and `.env` it logs into Steam.

### Step 6: Run all gates

**Verify**:
- `bun run typecheck` → exit 0
- `bun run test` → `19 pass`, `0 fail`
- `bun run format:check` → passes (run `bun run format` once if it doesn't)

## Test plan

- `src/schema/config.schema.test.ts` (new, 4 tests): env resolution, empty
  account list, missing env var, invalid resolved username.
- Model after `src/services/token.service.test.ts` (setup/teardown with `beforeEach`/`afterEach`).
- Build-output greps and the temp-dir smoke test (Steps 4–5) cover the runtime loading.

## Done criteria

- [ ] `bun run typecheck` exits 0; `bun run test` reports `19 pass`, `0 fail`
- [ ] `grep -c "from \"../config.json\"" src/config.ts` → `0`
- [ ] `grep -c "Config file not found" build/index.js` → `1`
- [ ] `grep -Ec 'steamData:"|"steamData":"' build/index.js` → `0`
- [ ] `git diff --stat main...HEAD` lists only the four in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- `bun run build` output still contains `steamData:"` after Step 4.
- `ConfigSchema.parse` throws a `ZodError` instead of the plain
  `Missing required environment variable` message in the third test, and you
  can't make the test pass without changing `resolveEnv`.
- Anything suggests the config must live next to the executable rather than in
  the working directory (e.g. a README instruction saying so) — report it; don't guess.

## Maintenance notes

- `config.json` is resolved against the **working directory**, like `steamData`
  and `tokens`. Double-clicking `cilantro.exe` uses the exe's folder as cwd.
- A new account field needs to be added to `AccountSchema`; the whole file is
  validated now, so unknown keys are stripped silently (zod default).
- Bun loads `.env` from the working directory too, so `.env` and `config.json`
  must sit together.
