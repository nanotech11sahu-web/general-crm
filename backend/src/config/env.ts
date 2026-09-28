import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGO_URI', 'mongodb://localhost:27017/pmc_crm'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev_access_secret'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev_refresh_secret'),
  jwtAccessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  jwtRefreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '7d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  apiPublicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 4000)}`,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  encryptionKey: required('ENCRYPTION_KEY', 'dev_only_encryption_key_do_not_use_in_prod'),
  // Meta app credentials (App ID/Secret) are NOT server-wide env vars — each workspace
  // registers and stores its own Meta app via Settings > App Store (see MetaAppConfig).
  metaApiVersion: process.env.META_API_VERSION ?? 'v21.0',
};
