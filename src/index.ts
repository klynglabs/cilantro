import { Bot } from "@/bot"
import { config } from "@/config"
import { TokenService } from "@/services/token.service"

const tokens = new TokenService(config.tokens)
const bots = config.accounts.map(
  (account) => new Bot(account, tokens, config.steamData),
)

process.on("SIGINT", async () => {
  await Promise.all(bots.map((bot) => bot.stop()))
  process.exit(0)
})

await Promise.all(bots.map((bot) => bot.run()))
process.exit(1)
