import { z } from 'zod'

export const AccountSchema = z.object({
  username: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.@]+$/),
  password: z.string().min(1),
  games: z.array(z.number().int().positive()).min(1).max(32),
  online: z.boolean().default(false).optional(),
})

export type Account = z.infer<typeof AccountSchema>
