import { randomBytes, timingSafeEqual } from 'node:crypto';

const requireEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  refreshTokenSecret: requireEnv('REFRESH_TOKEN_SECRET'),
  extensionSharedSecret: process.env.EXTENSION_SHARED_SECRET ?? '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  tokenIssuer: process.env.TOKEN_ISSUER ?? 'remote-sync',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL ?? '7d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? '10'),
  rateLimitAuthWindow: Number(process.env.RATE_LIMIT_AUTH_WINDOW ?? '60000'),
  rateLimitAuthMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? '60')
};

export const createRandomToken = (bytes = 48): string => randomBytes(bytes).toString('hex');

export const verifySignature = (payload: string, signature: string): boolean => {
  if (!config.extensionSharedSecret) {
    return true;
  }

  if (!signature) {
    return false;
  }

  const hmac = require('node:crypto').createHmac('sha256', config.extensionSharedSecret);
  hmac.update(payload);
  const expected = hmac.digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
};

