# Cilantro

> A lightweight Steam hour booster powered by Bun

- Farm hours for **multiple games** on **multiple accounts**.
- **Steam Guard** supported.
- Built with [Bun](https://bun.sh/) and [node-steam-user](https://github.com/DoctorMcKay/node-steam-user).

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

Or build and run for production:

```bash
bun run build
bun run start
```

### Steam Guard

If your account has Steam Guard enabled, you'll be prompted for a code on first login. A [refresh token](https://github.com/DoctorMcKay/node-steam-user?tab=readme-ov-file#using-refresh-tokens) is saved afterward for future sessions.

## Configuration

Rename `config.example.json` to `config.json` and edit it:

Find game IDs on [SteamDB](https://steamdb.info/).

## Credits

Inspired by [steam-hour-booster](https://github.com/DrWarpMan/steam-hour-booster) by [DrWarpMan](https://github.com/DrWarpMan).

---

Not affiliated with Valve Corporation or Steam. Use at your own risk.
