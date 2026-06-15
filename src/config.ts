import { ConfigSchema } from "@/schema/config.schema";
import { resolveEnv } from "@/utils/resolve-env";

import configFile from "../config.json";

if (!configFile.accounts) {
  throw new Error("No accounts found in config file");
}

export const config = ConfigSchema.parse({
  accounts: configFile.accounts.map((account) => ({
    ...account,
    username: resolveEnv(account.username),
    password: resolveEnv(account.password),
  })),
  steamData: configFile.steamData,
  tokens: configFile.tokens,
});
