import { z } from 'zod'

import { AccountSchema } from '@/schema/account.schema'

export const ConfigSchema = z.object({
  steamData: z.string(),
  tokens: z.string(),
  accounts: z.array(AccountSchema),
})

export type Config = z.infer<typeof ConfigSchema>
