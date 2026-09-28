import { once } from "node:events";

import Steam, { EConnectionProtocol } from "steam-user";

import { SteamEvents } from "@/events/steam.events";
import type { Account } from "@/schema/account.schema";
import { TokenService } from "@/services/token.service";
import { Logger } from "@/utils/logger";
import { convertRelativePath } from "@/utils/path";
import { withRetry } from "@/utils/retry";
import type { SteamError } from "@/utils/steam-error";
import { invalidatesToken, isFatal } from "@/utils/steam-error";

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

    // steam-user throws on unhandled "error" events; run() and logOn() consume them with once().
    this.steam.on("error", () => {});

    new SteamEvents(this).bind();
  }

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

  async stop(): Promise<void> {
    if (!this.steam.steamID) return;
    this.steam.logOff();
    await once(this.steam, "disconnected");
  }

  syncGames(blocked: boolean): void {
    this.steam.gamesPlayed(blocked ? [] : [...this.account.games]);
    if (!blocked) this.logger.log(`Playing ${this.account.games.length} game(s)`);
  }

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

  private async getCredentials(): Promise<Steam.LogOnDetailsRefresh | Steam.LogOnDetailsNamePass> {
    const token = await this.tokens.get(this.account.username);

    if (token) {
      return {
        refreshToken: token,
        renewRefreshTokens: true,
      } as Steam.LogOnDetailsRefresh;
    }

    return {
      accountName: this.account.username,
      password: this.account.password,
      renewRefreshTokens: true,
    } as Steam.LogOnDetailsNamePass;
  }
}
