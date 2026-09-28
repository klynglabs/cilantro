# Plan 004: Replace Prettier with oxfmt + oxlint, matching the style the code is already written in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 2b37348 -- prettier.config.ts package.json .gitattributes .oxfmtrc.json src/bot.ts src/events/steam.events.ts src/utils/logger.ts tsconfig.json`
> Expected: empty output. If anything shows up, compare the files with the
> "Current state" excerpts below and STOP on a mismatch.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `2b37348`, 2026-09-28 (revised: Prettier → oxfmt/oxlint at the maintainer's request)

## Project rules (apply to every change in this plan)

- Read `CLAUDE.md` in the repo root before starting and follow it throughout:
  think before coding (state assumptions, stop and ask when unclear),
  simplicity first (minimum code, nothing speculative), surgical changes
  (every changed line traces to this plan), goal-driven execution (every step
  has a verify command; loop until it passes).
- No useless comments. Add a comment only when the code cannot explain itself
  (a non-obvious *why*). Never restate what the code does and never mention
  this plan, a step, or "fix". This plan's files need no comments.

## Why this matters

`prettier.config.ts` asks for single quotes and no semicolons, but every source
file uses double quotes, semicolons and ~100-column lines. Running
`bun run format` today would rewrite the whole codebase into a style nobody
writes, so nobody can run it, and CONTRIBUTING.md tells contributors to run it.
Prettier is also not a devDependency (the script uses `bunx`, so the version
floats). There is no linter at all.

The maintainer chose the Oxc toolchain: **oxfmt** (Prettier-compatible
formatter) and **oxlint** (linter). oxfmt's defaults are already the code's
style (double quotes, semicolons, `printWidth` 100, trailing commas, 2-space
indent), and it has built-in import sorting, so the Prettier plugin goes away.
oxlint's default rule set reports zero diagnostics on the current code.

After this plan, `bun run format` is a near no-op on the existing code, and
`bun run format:check` and `bun run lint` can gate every later change.

## Current state

- `prettier.config.ts` (whole file — will be deleted):

  ```ts
  const config = {
    plugins: ['@ianvs/prettier-plugin-sort-imports'],
    importOrder: ['<TYPES>', '', '<THIRD_PARTY_MODULES>', '', '^@/(.*)$|^@$'],
    importOrderParserPlugins: ['typescript'],
    importOrderTypeScriptVersion: '5.0.0',
    singleQuote: true,
    semi: false,
  }

  export default config
  ```

- `package.json` `scripts` (whole block):

  ```json
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "build": "bun scripts/build.ts",
    "compile": "bun scripts/compile.ts",
    "start": "bun build/index.js",
    "format": "bunx prettier . --write"
  },
  ```

  `devDependencies` contain `@ianvs/prettier-plugin-sort-imports`, `@tsconfig/bun`,
  `@types/bun`, `@types/steam-user`, `typescript`. No `prettier`, `oxfmt` or `oxlint`.
- The import blocks oxfmt will reorder (verified against oxfmt 0.71.0 with the
  config in Step 3):
  - `src/bot.ts` lines 5–6: `import type { Account } from "@/schema/account.schema";`
    currently sits *above* `import { SteamEvents } from "@/events/steam.events";`;
    oxfmt swaps them (sorted by path: `@/events` < `@/schema`).
  - `src/events/steam.events.ts` lines 1–4:
    ```ts
    import type Steam from "steam-user";
    import type { Bot } from "@/bot";

    import { withStdinLock } from "@/utils/stdin-lock";
    ```
    oxfmt moves the blank line so `steam-user` (external) is separated from the
    two `@/` (internal) imports.
  - `src/utils/logger.ts` lines 1–3: the blank line between
    `import type { ChalkInstance } from "chalk";` and `import chalk from "chalk";`
    is removed (same module, same group).
- `tsconfig.json` has trailing commas (after `["./src/*"]`, the `paths` object and
  the `exclude` array); oxfmt removes them. `tsc` accepts both forms.
- `CLAUDE.md` has lists directly under a text line; oxfmt inserts a blank line
  before each of the 5 lists. Content is unchanged.
- Git index stores every file with LF, but `core.autocrlf=true` on the
  maintainer's machine and there is no `.gitattributes`, so working copies can be
  CRLF (`git ls-files --eol` shows `w/crlf` for e.g. `src/utils/stdin-lock.ts`).
  oxfmt's `endOfLine` is `lf`, and `oxfmt --check` fails on CRLF files.
- oxfmt and oxlint both skip `.gitignore`d paths (`build`, `node_modules`,
  `config.json`, …). `plans/` is tracked, holds advisor documents, and must be
  excluded from formatting.

## Commands you will need

| Purpose       | Command                  | Expected on success                                 |
|---------------|--------------------------|-----------------------------------------------------|
| Install       | `bun install`            | exit 0                                              |
| Format        | `bun run format`         | exit 0                                              |
| Format check  | `bun run format:check`   | `All matched files use the correct format.`, exit 0 |
| Lint          | `bun run lint`           | exit 0, no output                                   |
| Typecheck     | `bunx tsc --noEmit`      | exit 0, no output                                   |

## Scope

**In scope** (the only files you should modify, create or delete):
- `prettier.config.ts` (delete)
- `package.json`, `bun.lock` (dependencies via `bun add` / `bun remove` only; `scripts` by hand)
- `.oxfmtrc.json` (create)
- `.gitattributes` (create)
- Files rewritten by `bun run format` in Step 5 — only the expected list there.

**Out of scope** (do NOT touch):
- Any hand edit to `src/**` — formatting changes come only from running the formatter.
- `CONTRIBUTING.md` — `bun run format` stays valid; plan 005 rewrites that section and adds `lint`.
- `plans/**`.
- An `.oxlintrc.json` — oxlint's defaults are enough; do not create one.
- `tsconfig.json` settings (the formatter only removes trailing commas).

## Git workflow

- Branch: `advisor/004-oxfmt-oxlint`
- Conventional commits, matching `git log` (e.g. `fix(bot): serialize steam guard stdin reads (#2)`).
  Two commits: `chore: replace prettier with oxfmt and oxlint` (Steps 1–4) and
  `style: apply oxfmt` (Step 5).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Swap the dependencies

Run:

```
bun remove @ianvs/prettier-plugin-sort-imports
bun add -d oxfmt oxlint
```

**Verify**:
- `bunx oxfmt --version` → prints `0.x.y` (0.71.0 or later 0.x)
- `bunx oxlint --version` → prints `1.x.y`
- `grep -c "prettier" package.json` → `1` (only the `format` script, fixed in Step 4)

### Step 2: Delete `prettier.config.ts`

`git rm prettier.config.ts`

**Verify**: `ls prettier.config.ts` → "No such file or directory".

### Step 3: Create `.oxfmtrc.json`

Exact content:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "sortImports": true,
  "sortPackageJson": false,
  "ignorePatterns": ["plans/"]
}
```

Why each key: formatting options are all left at oxfmt's defaults because those
defaults already match the code. `sortImports: true` replaces the Prettier
import-sorting plugin (default groups: builtin → external → `@/` internal,
blank line between groups). `sortPackageJson: false` because oxfmt otherwise
reorders `package.json` keys and keywords, which is churn nobody asked for.
`plans/` holds advisor documents, not source.

**Verify**: `bunx oxfmt --check src/utils/retry.ts` → `All matched files use the correct format.`
(If this fails only because the file is CRLF, that's expected until Step 4/5 — check
with `file src/utils/retry.ts`; if it says CRLF, move on.)

### Step 4: Scripts and `.gitattributes`

In `package.json`, replace the `"format"` line and add two scripts right after it,
so the end of `scripts` reads:

```json
    "start": "bun build/index.js",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "lint": "oxlint --deny-warnings"
  },
```

Leave every other script unchanged. `--deny-warnings` is needed because
oxlint's default rules report as warnings and exit 0.

Create `.gitattributes` (one line):

```
* text=auto eol=lf
```

**Verify**:
- `git check-attr eol -- src/bot.ts` → `src/bot.ts: eol: lf`
- `bun run lint` → exit 0, no output
- `grep -c "prettier" package.json` → `0`

Commit: `chore: replace prettier with oxfmt and oxlint`.

### Step 5: Run the formatter

Run `bun run format`, then `git add --renormalize .`, `git add -A` and
`git diff --cached --stat`.

`git status` before staging may list many files whose working copy only changed
from CRLF to LF. The index already stores LF, so after staging they drop out of
the diff.

Expected in `git diff --cached --stat`, and nothing else:
- `CLAUDE.md` — 5 blank lines inserted before lists
- `src/bot.ts` — the two import lines described in "Current state" swap
- `src/events/steam.events.ts` — blank line moves (external vs internal group)
- `src/utils/logger.ts` — one blank line removed between the two `chalk` imports
- `tsconfig.json` — trailing commas removed

Inspect `git diff --cached -- src` and confirm every hunk is an import line
move or a blank line.

**Verify**:
- `bun run format:check` → `All matched files use the correct format.`, exit 0
- `bun run lint` → exit 0, no output
- `bunx tsc --noEmit` → exit 0
- `git ls-files --eol | grep -c "i/crlf"` → `0`

Commit: `style: apply oxfmt`.

## Test plan

No runtime behavior changes; there is no test suite yet (plan 005 adds one).
The gates are `format:check`, `lint` and `tsc --noEmit`.

## Done criteria

- [ ] `bun run format:check` exits 0 and prints `All matched files use the correct format.`
- [ ] `bun run lint` exits 0 with no output
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `prettier.config.ts` does not exist; `grep -ci prettier package.json` → `0`
- [ ] `package.json` devDependencies contain `oxfmt` and `oxlint`; scripts contain `format`, `format:check`, `lint` exactly as in Step 4
- [ ] `.oxfmtrc.json` and `.gitattributes` exist with the contents above; no `.oxlintrc.json`
- [ ] `git diff --stat main...HEAD` lists only: `.gitattributes`, `.oxfmtrc.json`, `CLAUDE.md`, `bun.lock`, `package.json`, `prettier.config.ts`, `src/bot.ts`, `src/events/steam.events.ts`, `src/utils/logger.ts`, `tsconfig.json`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 5 modifies a file not in the expected list, or changes anything other
  than import order / blank lines in a `.ts` file.
- `bun run lint` reports any diagnostic (don't fix source code, and don't
  disable rules — report the output).
- `tsc --noEmit` fails after formatting.
- `bun add -d oxfmt` installs a version ≥ 1.0 and the Step 3 verify fails
  (config keys may have changed).

## Maintenance notes

- `format:check` and `lint` are the gates later plans (and a future CI job) rely on.
- oxfmt is pre-1.0: `^0.x` in `package.json` pins the minor version. Bumping it
  can change output; run `bun run format` and review the diff as its own commit.
- `.gitattributes` overrides `core.autocrlf` for this repo; contributors on
  Windows get LF working copies after their next checkout.
- To tighten linting later, add `.oxlintrc.json` (`bunx oxlint --init`) rather
  than passing rule flags in the script.
