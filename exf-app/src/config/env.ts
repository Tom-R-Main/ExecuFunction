import { config as loadDotenv } from 'dotenv';

// Load .env in local dev only; Cloud Run will inject env vars.
if (process.env.NODE_ENV !== 'production') {
  loadDotenv();
}

type EnvConfig = {
  nodeEnv: string;
  port: number;
  buildSha: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
};

const numberFromEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env: EnvConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: numberFromEnv(process.env.PORT, 8080),
  buildSha: process.env.BUILD_SHA ?? 'dev',
  logLevel: (process.env.LOG_LEVEL as EnvConfig['logLevel']) ?? 'info'
};

export default env;
