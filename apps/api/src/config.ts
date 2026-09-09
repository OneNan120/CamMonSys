import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Invalid environment. Set PORT, NODE_ENV, and DATABASE_URL as documented in .env.example.');
}
export const env = parsed.data;
