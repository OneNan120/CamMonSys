import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  TEST_DATABASE_URL: z.string().url().optional(),
  LIVEKIT_URL: z.string().url().startsWith('wss://'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  AUTH_SESSION_DURATION_SECONDS: z.coerce.number().int().positive().default(28800),
  CAMERA_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  CAMERA_PUBLISHING_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  CAMERA_CLEANUP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  SSE_KEEPALIVE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error('Invalid environment. Set PORT, NODE_ENV, and DATABASE_URL as documented in .env.example.');
}

const configValues = parsed.data;

if (
  configValues.NODE_ENV === 'test' &&
  !configValues.TEST_DATABASE_URL
) {
  throw new Error('TEST_DATABASE_URL is required when running tests.');
}

if (
  configValues.NODE_ENV === 'test' &&
  configValues.TEST_DATABASE_URL === configValues.DATABASE_URL
) {
  throw new Error('Tests must use a separate database.');
}

if (
  parsed.data.CAMERA_PUBLISHING_LEASE_SECONDS <
  parsed.data.CAMERA_HEARTBEAT_INTERVAL_SECONDS * 3
) {
  throw new Error(
    'Camera publishing lease must allow at least three heartbeat intervals.',
  );
}

export const env = {
  ...configValues,
  DATABASE_URL:
    configValues.NODE_ENV === 'test'
      ? configValues.TEST_DATABASE_URL!
      : configValues.DATABASE_URL,
};
