# Plan 003: Add missing config.json setup step to README and add typecheck script

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 9e868f9..HEAD -- README.md package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx, docs
- **Planned at**: commit `9e868f9`, 2026-06-15

## Why this matters

**Missing README step**: `src/config.ts` does a static `import configFile from "../config.json"` at module load. If `config.json` does not exist, Bun fails immediately with a cryptic module-not-found error — not a helpful "please copy config.example.json" message. The current README quickstart walks through `bun install` and `.env` setup, then jumps straight to `bun run dev` with no mention of copying `config.example.json`. A new user following the README will hit this error on first run.

**Missing typecheck script**: `package.json` has `dev`, `build`, `build:exe`, `start`, and `format`, but no `typecheck` or `check` command. There is no one-command way for contributors or CI to verify type correctness without knowing to run `bun tsc --noEmit` manually. This is a gap called out in the audit playbook as a DX finding.

## Current state

**`README.md` — quickstart section (lines 13–45)**

```markdown
## Requirements

- [Bun](https://bun.sh/)

## Usage

Install dependencies:

```bash
bun install
```

Set up your environment:

```bash
cp .env.example .env
```

```env
STEAM_ACCOUNT_USERNAME="your_username"
STEAM_ACCOUNT_PASSWORD="your_password"
```

Run in development (with watch mode):

```bash
bun run dev
```
```

The `Configuration` section (later in the file) briefly says "Rename
`config.example.json` to `config.json`" but it's buried after the run
commands, so users who stop reading after the quickstart miss it entirely.

**`package.json` — scripts section (lines 7–13)**

```json
"scripts": {
  "dev": "bun --watch src/index.ts",
  "build": "bun build src/index.ts --target=bun --minify --packages=external --outfile=build/index.js",
  "build:exe": "bun build src/index.ts --compile --target=bun-windows-x64-modern --minify --packages=external --outfile=cilantro",
  "start": "bun build/index.js",
  "format": "bunx prettier . --write"
},
```

**`config.example.json` — what users copy (for reference)**

```json
{
  "steamData": "./.steam",
  "tokens": "./.tokens",
  "accounts": [
    {
      "username": "STEAM_ACCOUNT_USERNAME",
      "password": "STEAM_ACCOUNT_PASSWORD",
      "games": [730],
      "online": true
    }
  ]
}
```

The `username` and `password` values are environment variable **names**, not
literal credentials. The `.env` file holds the actual values. This
env-var-name-in-config pattern is non-obvious to first-time users.

## Commands you will need

| Purpose    | Command            | Expected on success  |
|------------|--------------------|----------------------|
| Typecheck  | `bun tsc --noEmit` | exits 0, no output   |

## Scope

**In scope** (the only files you should modify):
- `README.md`
- `package.json`

**Out of scope** (do NOT touch):
- `config.example.json` — correct as-is
- `.env.example` — correct as-is
- Any source file under `src/`

## Git workflow

- Branch: `advisor/003-readme-and-typecheck`
- Conventional Commits style (matches repo history): `docs: add config.json setup step and typecheck script`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `typecheck` script to `package.json`

In `package.json`, add `"typecheck"` to the `scripts` object, after `"format"`:

```json
"scripts": {
  "dev": "bun --watch src/index.ts",
  "build": "bun build src/index.ts --target=bun --minify --packages=external --outfile=build/index.js",
  "build:exe": "bun build src/index.ts --compile --target=bun-windows-x64-modern --minify --packages=external --outfile=cilantro",
  "start": "bun build/index.js",
  "format": "bunx prettier . --write",
  "typecheck": "tsc --noEmit"
},
```

**Verify**: `bun run typecheck` → exits 0, no output. (This is the same as
`bun tsc --noEmit`; the script just makes it discoverable.)

### Step 2: Insert config.json setup into README quickstart

In `README.md`, find the block:

```markdown
Set up your environment:

```bash
cp .env.example .env
```

```env
STEAM_ACCOUNT_USERNAME="your_username"
STEAM_ACCOUNT_PASSWORD="your_password"
```

Run in development (with watch mode):
```

Replace it with:

```markdown
Set up your config:

```bash
cp config.example.json config.json
```

Edit `config.json` to add your game IDs. Find game IDs on [SteamDB](https://steamdb.info/).

Set up your environment:

```bash
cp .env.example .env
```

```env
STEAM_ACCOUNT_USERNAME="your_username"
STEAM_ACCOUNT_PASSWORD="your_password"
```

> The `username` and `password` fields in `config.json` are environment variable **names**, not literal values. The `.env` file holds the actual credentials.

Run in development (with watch mode):
```

This inserts the config copy step at the start of setup (before .env), and adds
a clarifying note about the env-var-name pattern so users understand why the
config doesn't contain their actual credentials.

**Verify**: visually confirm the README renders correctly. Confirm the
`Configuration` section that was already there (mentioning SteamDB) still reads
without duplication — the new mention of SteamDB in the quickstart is intentional
(it's a more prominent placement); the Configuration section can remain as
additional context or be simplified to avoid repeating the SteamDB link.

### Step 3: Confirm the existing `Configuration` section is not redundant

Read the current `Configuration` section in `README.md`. If it now purely
repeats what the quickstart says, simplify it to:

```markdown
## Configuration

Edit `config.json` to configure accounts and game IDs. Multiple accounts and up
to 32 games per account are supported.
```

If the `Configuration` section contains any information not covered by the
quickstart insertion, keep it intact. Do not delete content that the quickstart
doesn't cover.

**Verify**: `bun run typecheck` → exits 0 (README changes don't affect
typecheck, but run it to confirm no package.json edits broke anything).

## Test plan

This plan has no code changes. Verification is manual:

1. In a fresh directory (or using a temporary copy), follow the README
   quickstart step by step. Confirm you can reach `bun run dev` without a
   module-not-found error for `config.json`.

2. Confirm `bun run typecheck` is listed in `bun run --help` output (or just
   run it and confirm exit 0).

## Done criteria

- [ ] `bun run typecheck` exits 0
- [ ] `package.json` contains `"typecheck": "tsc --noEmit"` in the `scripts` object
- [ ] `README.md` quickstart contains `cp config.example.json config.json` before the `.env` step
- [ ] `README.md` contains the env-var-name clarification note
- [ ] No files outside the in-scope list are modified (`git diff --name-only`)
- [ ] `plans/README.md` status row updated to DONE

## STOP conditions

- The README structure at the cited location doesn't match the excerpt in
  "Current state" (e.g., sections were reordered or content was already updated).
- `bun run typecheck` fails after adding the script (would indicate a pre-existing
  type error — stop and report rather than fixing unrelated type errors).

## Maintenance notes

- The env-var-name-in-config pattern is a deliberate design: credentials stay
  out of the config file (which might be shared or checked in accidentally).
  The clarification note added here is the only documentation of this design —
  if the pattern ever changes (e.g., supporting literal values directly in
  config), update both the note and `src/utils/resolve-env.ts`.
- `bun run typecheck` can be added to CI or a pre-commit hook in a follow-up.
  This plan only adds the script; it does not wire it into any automated pipeline.
