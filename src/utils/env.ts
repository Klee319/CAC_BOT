import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'Discord token is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'Discord client ID is required'),
  GOOGLE_CLIENT_EMAIL: z.string().email('Invalid Google client email'),
  GOOGLE_PRIVATE_KEY: z.string().min(1, 'Google private key is required'),
  GOOGLE_PROJECT_ID: z.string().min(1, 'Google project ID is required'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  DATABASE_PATH: z.string().default('./database/cac_bot.db'),
  NOTIFICATION_CHANNEL_ID: z.string().optional(),
  LOG_CHANNEL_ID: z.string().optional(),
  ADMIN_ROLE_ID: z.string().optional(),
  MEMBER_ROLE_ID: z.string().optional(),
  MEMBER_SPREADSHEET_ID: z.string().optional(),
  MEMBER_SHEET_NAME: z.string().default('部員名簿'),
  WELCOME_MESSAGE: z.string().default('ようこそ！'),
});

function validateEnv(): z.infer<typeof EnvSchema> {
  try {
    return EnvSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`環境変数の設定に不備があります:\n${missingVars.join('\n')}`);
    }
    throw error;
  }
}

export const env = validateEnv();

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';