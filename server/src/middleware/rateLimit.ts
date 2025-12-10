import type { RequestHandler } from 'express';
import { config } from '../config';

type RateKey = string;

const buckets = new Map<RateKey, { hits: number; reset: number }>();

export const authRateLimiter: RequestHandler = (req, res, next) => {
  const now = Date.now();
  const window = config.rateLimitAuthWindow;
  const max = config.rateLimitAuthMax;
  const identifier = (req.body?.email ?? req.body?.deviceId ?? '').toString().toLowerCase() || 'unknown';
  const key = `${req.ip ?? 'unknown'}:${identifier}`;

  const bucket = buckets.get(key);

  if (!bucket || bucket.reset < now) {
    buckets.set(key, { hits: 1, reset: now + window });
    next();
    return;
  }

  if (bucket.hits >= max) {
    res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
    return;
  }

  bucket.hits += 1;
  next();
};

