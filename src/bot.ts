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
  games: number[]
  online?: boolean
}

export class Bot {
  private readonly tokens = new TokenStorage()
  private readonly logger: Logger

  private readonly username: string
  private readonly password: string
  private readonly games: number[]
  private readonly online: boolean
  private readonly steam: Steam

  private blocked = false

  constructor({ username, password, games, online = false }: BotOptions) {
    this.username = username.toLowerCase()
    this.password = password
    this.games = games
    this.online = online

    this.steam = new Steam({
      autoRelogin: false,
      dataDirectory: convertRelativePath(config.steamData),
      protocol: EConnectionProtocol.TCP,
    })

    this.logger = new Logger(this.username)

    this.steam.on('error', (error) => {
      switch (error.message) {
        case 'LoggedInElsewhere':
          this.logger.error('Logged in from another client')
          break
        default:
          this.logger.error(error.message)
      }

      void this.handleError()
    })

    this.steam.on('playingState', (blocked, appId) => {
      this.blocked = blocked
      if (!blocked && appId !== 0) return
      this.play()
    })

    this.steam.on('steamGuard', async (_, callback) => {
      this.logger.warn('Enter Steam Guard code')
      for await (const line of console) {
        if (!line) process.exit(1)
        callback(line)
        console.clear()
        break
      }
    })

    this.steam.on('refreshToken', (token) =>
      this.tokens.set(this.username, token),
    )
  }

  async login(): Promise<void> {
    this.logger.log('Logging in...')

    this.steam.logOn(await this.getLoginDetails())
    await Promise.race([
      once(this.steam, 'loggedOn'),
      once(this.steam, 'error').then(([err]) => {
        throw err
      }),
    ])

    if (this.online) this.steam.setPersona(Steam.EPersonaState.Online)
  }

  private async logout(): Promise<void> {
    this.steam.logOff()
    await once(this.steam, 'disconnected')
  }

  private async getLoginDetails(): Promise<Parameters<Steam['logOn']>[0]> {
    const token = await this.tokens.get(this.username)
    if (token) {
      return {
        refreshToken: token,
        renewRefreshTokens: true,
      } as Steam.LogOnDetailsRefresh
    }
    return {
      accountName: this.username,
      password: this.password,
      renewRefreshTokens: true,
    } as Steam.LogOnDetailsNamePass
  }

  private play(): void {
    if (this.blocked) {
      return this.steam.gamesPlayed([])
    }

    this.steam.gamesPlayed(this.games)
    this.logger.log(`Playing ${this.games.length} game(s)`)
  }

  private async handleError(): Promise<void> {
    try {
      await this.logout()
      await withRetry(() => this.login(), {
        attempts: 10,
        delayMs: 1e4,
        factor: 2,
        onRetry: (i, delay) =>
          this.logger.warn(`Retry ${i}/10 in ${delay / 1e3}s...`),
      })
    } catch {
      this.logger.error('Failed to reconnect')
      this.steam.logOff()
    }
  }
}
