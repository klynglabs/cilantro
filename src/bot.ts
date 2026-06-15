import { once } from "node:events";

import Steam, { EConnectionProtocol } from "steam-user";

import type { Account } from "@/schema/account.schema";
import { SteamEvents } from "@/events/steam.events";
import { TokenService } from "@/services/token.service";
import { Logger } from "@/utils/logger";
import { convertRelativePath } from "@/utils/path";
import { withRetry } from "@/utils/retry";

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
      protocol: EConnectionProtocol.TCP,
    });

    new SteamEvents(this).bind();
  }

  async start(): Promise<void> {
    this.logger.log("Logging in...");
    this.steam.logOn(await this.getCredentials());

    await Promise.race([
      once(this.steam, "loggedOn"),
      once(this.steam, "error").then(([error]) => {
        throw error;
      }),
    ]);

    if (this.account.online) this.steam.setPersona(Steam.EPersonaState.Online);
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

  async reconnect(): Promise<void> {
    try {
      await this.stop();
      await withRetry(() => this.start(), {
        attempts: 10,
        delayMs: 10_000,
        factor: 2,
        onRetry: (attempt, total, delay) =>
          this.logger.warn(`Retry ${attempt}/${total} in ${delay / 1_000}s...`),
      });
    } catch {
      this.logger.error("Failed to reconnect");
      this.steam.logOff();
    }
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
