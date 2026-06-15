import { Bot } from "@/bot";
import { config } from "@/config";
import { TokenService } from "@/services/token.service";

const tokens = new TokenService(config.tokens);

const bots = await Promise.all(
  config.accounts.map(async (account) => {
    const bot = new Bot(account, tokens, config.steamData);
    await bot.start();
    return bot;
  }),
);

process.on("SIGINT", async () => {
  await Promise.all(bots.map((bot) => bot.stop()));
  process.exit(0);
});
