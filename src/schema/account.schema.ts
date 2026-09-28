import { z } from "zod";

import { resolveEnv } from "@/utils/resolve-env";

const envVar = z.string().min(1).transform(resolveEnv);

export const AccountSchema = z.object({
  username: envVar.pipe(z.string().regex(/^[a-zA-Z0-9_.@]+$/)),
  password: envVar,
  games: z.array(z.number().int().positive()).min(1).max(32),
  online: z.boolean().default(false),
});

export type Account = z.infer<typeof AccountSchema>;
