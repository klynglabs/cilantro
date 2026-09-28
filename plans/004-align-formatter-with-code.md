# Plan 004: Make `bun run format` produce the style the code is already written in

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 56ffc99 -- prettier.config.ts package.json .gitattributes .prettierignore CONTRIBUTING.md`
> Expected: only `package.json` may show up (script changes for `build`/`compile`
> that the maintainer made after this plan was written). If `prettier.config.ts`
> shows up, or `package.json` no longer contains the `format` script shown
> below, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `56ffc99`, 2026-09-28

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
floats), and the import-order setting glues `node:` imports onto type imports.
After this plan, `bun run format` is a near no-op on the existing code and
`bun run format:check` can gate every later change.

## Current state

- `prettier.config.ts` (whole file):

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

- `package.json` scripts include `"format": "bunx prettier . --write"`.
  devDependencies include `@ianvs/prettier-plugin-sort-imports` but not
  `prettier`.
- The code style that is actually used (exemplar `src/utils/retry.ts`):
  double quotes, semicolons, trailing commas, 2-space indent, lines up to 100
  columns (see the `getCredentials` signature in `src/bot.ts`, which is 99
  characters wide).
- Git index stores every file with LF, but `core.autocrlf=true` on the
  maintainer's machine and there is no `.gitattributes`, so several working
  copies are CRLF (`git ls-files --eol` shows `w/crlf` for e.g.
  `src/utils/stdin-lock.ts`). Prettier's default `endOfLine` is `lf`, so
  `--check` would flag those files on Windows.
- There is no `.prettierignore`. Prettier 3 already skips `.gitignore`d paths
  (`build`, `node_modules`, `config.json`, …).

## Commands you will need

| Purpose       | Command                                   | Expected on success                           |
|---------------|-------------------------------------------|-----------------------------------------------|
| Install       | `bun install`                             | exit 0                                        |
| Format        | `bun run format`                          | exit 0                                        |
| Format check  | `bun run format:check`                    | `All matched files use Prettier code style!`  |
| Typecheck     | `bunx tsc --noEmit`        | exit 0, no output                             |

## Scope

**In scope** (the only files you should modify or create):
- `prettier.config.ts`
- `package.json`, `bun.lock` (via `bun add` only)
- `.gitattributes` (create)
- `.prettierignore` (create)
- Files rewritten by `bun run format` in Step 5 — only the expected list there.

**Out of scope** (do NOT touch):
- Any hand edit to `src/**` — formatting changes come only from running the formatter.
- `tsconfig.json` settings (the formatter will only remove trailing commas).
- ESLint or any other new tool — not requested.

## Git workflow

- Branch: `advisor/004-align-formatter-with-code`
- Conventional commits, matching `git log` (e.g. `fix(bot): serialize steam guard stdin reads (#2)`).
  Suggested: `chore: align prettier config with code style` and
  `style: apply prettier`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add Prettier as a devDependency

Run `bun add -d prettier`.

**Verify**: `bunx prettier --version` → prints `3.x.y`;
`grep '"prettier"' package.json` → one line inside `devDependencies`.

### Step 2: Replace `prettier.config.ts`

Replace the whole file with:

```ts
const config = {
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    "<TYPES>",
    "",
    "<BUILTIN_MODULES>",
    "",
    "<THIRD_PARTY_MODULES>",
    "",
    "^@/(.*)$|^@$",
  ],
  importOrderParserPlugins: ["typescript"],
  importOrderTypeScriptVersion: "5.0.0",
  printWidth: 100,
};

export default config;
```

`singleQuote` and `semi` are removed so Prettier's defaults (double quotes,
semicolons) apply. `<BUILTIN_MODULES>` gets its own group so `node:` imports
are separated from type imports.

**Verify**: `bunx prettier --check src/utils/retry.ts` → `All matched files use Prettier code style!`

### Step 3: Update the scripts in `package.json`

Change `"format"` and add `"format:check"` right after it:

```json
"format": "prettier . --write",
"format:check": "prettier . --check",
```

Leave every other script unchanged.

**Verify**: `bun run format:check` runs (it may still report files; that's
fixed in Step 5) and does not print `command not found`.

### Step 4: Add `.gitattributes` and `.prettierignore`

`.gitattributes` (one line):

```
* text=auto eol=lf
```

`.prettierignore` (one line — `plans/` holds advisor documents that are edited
by tools, not source):

```
plans/
```

**Verify**: `git check-attr eol -- src/bot.ts` → `src/bot.ts: eol: lf`

### Step 5: Run the formatter

Run `bun run format`, then `git add -A` and `git diff --cached --stat`.

`git status` before staging may also list files whose working copy was only
converted from CRLF to LF (e.g. `README.md`, `src/utils/stdin-lock.ts`). The
index already stores LF, so after `git add -A` they drop out of the diff.

Expected content changes in `git diff --cached --stat`, besides the files from
Steps 1–4, and nothing else:
- `CLAUDE.md` — blank lines inserted before lists
- `src/bot.ts` — `import type { Account } …` moves to the top, followed by a blank line
- `src/config.ts` — `import configFile from "../config.json";` moves to the top
- `src/events/steam.events.ts` — the two `import type` lines swap order
- `tsconfig.json` — trailing commas removed

**Verify**:
- `bun run format:check` → `All matched files use Prettier code style!`
- `bunx tsc --noEmit` → exit 0
- `git ls-files --eol | grep -c "i/crlf"` → `0`

## Test plan

No runtime behavior changes; there is no test suite yet (plan 005 adds one).
The gates are `format:check` and `tsc --noEmit`.

## Done criteria

- [ ] `bun run format:check` prints `All matched files use Prettier code style!`
- [ ] `bunx tsc --noEmit` exits 0
- [ ] `prettier.config.ts` contains no `singleQuote` and no `semi`
- [ ] `package.json` devDependencies contain `prettier`; scripts contain `format` and `format:check` without `bunx`
- [ ] `.gitattributes` and `.prettierignore` exist with the contents above
- [ ] `git diff --stat main...HEAD` lists only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 5 modifies a file not in the expected list, or changes anything other
  than import order / whitespace / trailing commas in a `.ts` file.
- `tsc --noEmit` fails after formatting.
- `bun add -d prettier` installs a major version other than 3.

## Maintenance notes

- `format:check` is the gate that later plans (and a future CI job) rely on.
- `.gitattributes` overrides `core.autocrlf` for this repo; contributors on
  Windows get LF working copies after their next checkout.
- If ESLint is added later, add `eslint-config-prettier` so the two don't fight.
