import { once } from 'events'

import Steam, { EConnectionProtocol } from 'steam-user'

import { config } from '@/config'
import { Logger } from '@/utils/logger'
import { convertRelativePath } from '@/utils/path'
import { withRetry } from '@/utils/retry'
import { TokenStorage } from '@/utils/tokens'

export interface BotOptions {
  username: string
  password: string
  games: readonly number[]
  online?: boolean
}

export class Bot {
  private readonly tokens = new TokenStorage()
  private readonly logger: Logger
  private readonly steam: Steam
  private isBlocked = false

  constructor(private readonly options: BotOptions) {
    this.logger = new Logger(options.username.toLowerCase())
    this.steam = new Steam({
      autoRelogin: false,
      dataDirectory: convertRelativePath(config.steamData),
      protocol: EConnectionProtocol.TCP,
    })
    this.bindEvents()
  }

  async start(): Promise<void> {
    this.logger.log('Logging in...')
    this.steam.logOn(await this.getCredentials())
    await Promise.race([
      once(this.steam, 'loggedOn'),
      once(this.steam, 'error').then(([err]) => {
        throw err
      }),
    ])
    if (this.options.online) this.steam.setPersona(Steam.EPersonaState.Online)
  }

  async stop(): Promise<void> {
    if (!this.steam.steamID) return
    this.steam.logOff()
    await once(this.steam, 'disconnected')
  }

  private bindEvents(): void {
    this.steam.on('error', (err) => this.handleError(err))
    this.steam.on('playingState', (blocked, appId) => {
      this.isBlocked = blocked
      if (!blocked && appId !== 0) return
      this.syncGames()
    })
    this.steam.on('steamGuard', async (_, callback) => {
      this.logger.warn('Enter Steam Guard code')
      for await (const line of console) {
        const code = line?.trim()
        if (!code) process.exit(1)
        callback(code)
        break
      }
    })
    this.steam.on('refreshToken', (token) =>
      this.tokens.set(this.options.username, token),
    )
  }

  private async getCredentials(): Promise<Parameters<Steam['logOn']>[0]> {
    const token = await this.tokens.get(this.options.username)
    if (token) {
      return {
        refreshToken: token,
        renewRefreshTokens: true,
      } as Steam.LogOnDetailsRefresh
    }
    return {
      accountName: this.options.username,
      password: this.options.password,
      renewRefreshTokens: true,
    } as Steam.LogOnDetailsNamePass
  }

  private syncGames(): void {
    this.steam.gamesPlayed(this.isBlocked ? [] : [...this.options.games])
    if (!this.isBlocked)
      this.logger.log(`Playing ${this.options.games.length} game(s)`)
  }

  private handleError(error: Error): void {
    switch (error.message) {
      case 'LogonSessionReplaced':
        this.logger.error('Session replaced')
        return process.exit(1)
      case 'InvalidPassword':
        this.logger.error('Invalid credentials')
        return process.exit(1)
      case 'LoggedInElsewhere':
        this.logger.warn('Logged in elsewhere')
        break
      case 'NoConnection':
        this.logger.error('Connection dropped')
        break
      default:
        this.logger.error(error.message)
    }
    void this.reconnect()
  }

  private async reconnect(): Promise<void> {
    try {
      await this.stop()
      await withRetry(() => this.start(), {
        attempts: 10,
        delayMs: 10_000,
        factor: 2,
        onRetry: (i, delay) =>
          this.logger.warn(`Retry ${i}/10 in ${delay / 1_000}s...`),
      })
    } catch {
      this.logger.error('Failed to reconnect')
      this.steam.logOff()
    }
  }
}
