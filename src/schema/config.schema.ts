import { z } from "zod";

import { AccountSchema } from "@/schema/account.schema";

export const ConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, "No accounts found in config file"),
  steamData: z.string(),
  tokens: z.string(),
});

export type Config = z.infer<typeof ConfigSchema>;
