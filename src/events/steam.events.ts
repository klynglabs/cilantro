import type Steam from "steam-user";
import type { Bot } from "@/bot";

import { withStdinLock } from "@/utils/stdin-lock";

type EventHandler<K extends keyof Steam.Events> = (
  ...args: Steam.Events[K]
) => void | Promise<void>;

type EventHandlerMap = { [K in keyof Steam.Events]?: EventHandler<K> };

export class SteamEvents {
  constructor(private readonly bot: Bot) {}

  private readonly handlers: EventHandlerMap = {
    error: this.onError.bind(this),
    playingState: this.onPlayingState.bind(this),
    steamGuard: this.onSteamGuard.bind(this),
    refreshToken: this.onRefreshToken.bind(this),
  };

  bind(): void {
    for (const [event, handler] of Object.entries(this.handlers) as [
      keyof Steam.Events,
      (...args: any[]) => void | Promise<void>,
    ][]) {
      this.bot.steam.on(event, (...args) => {
        const result = handler(...args);
        if (result instanceof Promise) {
          result.catch((error) =>
            this.bot.logger.error(`Unhandled error in '${event}' event`, error),
          );
        }
      });
    }
  }

  private async onError(error: Error): Promise<void> {
    switch (error.message) {
      case "LogonSessionReplaced":
        this.bot.logger.error("Session replaced");
        return process.exit(1);
      case "InvalidPassword":
        this.bot.logger.error("Invalid credentials");
        await this.bot.tokens.del(this.bot.account.username);
        return process.exit(1);
      case "LoggedInElsewhere":
        this.bot.logger.warn("Logged in elsewhere");
        break;
      case "NoConnection":
        this.bot.logger.error("Connection dropped");
        break;
      default:
        this.bot.logger.error(error.message);
        await this.bot.tokens.del(this.bot.account.username);
    }

    await this.bot.reconnect();
  }

  private onPlayingState(blocked: boolean, appId: number): void {
    if (!blocked && appId !== 0) return;
    this.bot.syncGames(blocked);
  }

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

  private async onRefreshToken(token: string): Promise<void> {
    await this.bot.tokens.set(this.bot.account.username, token);
  }
}
