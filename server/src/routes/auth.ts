import type { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { prisma } from '../prisma';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth';
import { authLoginSchema, authLogoutSchema, authRefreshSchema, authSignupSchema } from '../validators';
import { authRateLimiter } from '../middleware/rateLimit';
import { config, createRandomToken } from '../config';
import { createAccessToken, createRefreshToken, revokeRefreshToken, verifyRefreshToken } from '../utils/tokens';

const toMilliseconds = (value: string | number) => {
  const result = ms(value as any);
  return typeof result === 'string' ? Number(result) : result;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const ensureSession = async (userId: string, deviceId: string, userAgent?: string) => {
  return prisma.session.upsert({
    where: {
      userId_deviceId: {
        userId,
        deviceId
      }
    },
    create: {
      userId,
      deviceId,
      userAgent
    },
    update: {
      userAgent,
      lastSeenAt: new Date()
    }
  });
};

const issueTokens = async (userId: string, deviceId: string, userAgent?: string) => {
  const session = await ensureSession(userId, deviceId, userAgent);
  const accessToken = createAccessToken(userId, session.id);
  const { rawToken: refreshToken, expiresAt } = await createRefreshToken(userId, session.id);
  return {
    accessToken,
    refreshToken,
    refreshExpiresAt: expiresAt.toISOString(),
    sessionId: session.id
  };
};

export const registerAuthRoutes = (router: Router) => {
  router.post('/auth/signup', authRateLimiter, async (req, res, next) => {
    try {
      const parsed = authSignupSchema.parse(req.body);
      const email = normalizeEmail(parsed.email);

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const passwordHash = await bcrypt.hash(parsed.password, config.bcryptRounds);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash
        }
      });

      const deviceId = parsed.deviceId || createRandomToken(12);
      const tokens = await issueTokens(user.id, deviceId, parsed.userAgent);

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          type: 'auth.signup',
          context: {
            sessionId: tokens.sessionId,
            deviceId
          }
        }
      });

      res.status(201).json({
        userId: user.id,
        email: user.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresInMs: toMilliseconds(config.accessTokenTtl),
        refreshExpiresAt: tokens.refreshExpiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/login', authRateLimiter, async (req, res, next) => {
    try {
      const parsed = authLoginSchema.parse(req.body);
      const email = normalizeEmail(parsed.email);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const valid = await bcrypt.compare(parsed.password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const deviceId = parsed.deviceId || createRandomToken(12);
      const tokens = await issueTokens(user.id, deviceId, parsed.userAgent);

      await prisma.auditEvent.create({
        data: {
          userId: user.id,
          type: 'auth.login',
          context: {
            sessionId: tokens.sessionId,
            deviceId
          }
        }
      });

      res.json({
        userId: user.id,
        email: user.email,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresInMs: toMilliseconds(config.accessTokenTtl),
        refreshExpiresAt: tokens.refreshExpiresAt
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/refresh', authRateLimiter, async (req, res, next) => {
    try {
      const parsed = authRefreshSchema.parse(req.body);
      let decoded: jwt.JwtPayload;
      try {
        decoded = jwt.verify(parsed.refreshToken, config.refreshTokenSecret) as jwt.JwtPayload;
      } catch {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      const userId = decoded.sub;
      const tokenId = decoded.tid as string | undefined;
      if (!userId) {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      const stored = await verifyRefreshToken(parsed.refreshToken, userId, tokenId);
      if (!stored) {
        res.status(401).json({ error: 'Refresh token expired or revoked' });
        return;
      }

      await revokeRefreshToken(stored.id);

      if (stored.sessionId) {
        await prisma.session.update({
          where: { id: stored.sessionId },
          data: { lastSeenAt: new Date() }
        });
      }

      const accessToken = createAccessToken(userId, stored.sessionId ?? undefined);
      const { rawToken: newRefreshToken, expiresAt } = await createRefreshToken(userId, stored.sessionId ?? undefined);

      await prisma.auditEvent.create({
        data: {
          userId,
          type: 'auth.refresh',
          context: {
            sessionId: stored.sessionId,
            replacedTokenId: stored.id
          }
        }
      });

      res.json({
        userId,
        accessToken,
        refreshToken: newRefreshToken,
        expiresInMs: toMilliseconds(config.accessTokenTtl),
        refreshExpiresAt: expiresAt.toISOString()
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', async (req, res, next) => {
    try {
      const parsed = authLogoutSchema.parse(req.body);

      const decoded = jwt.decode(parsed.refreshToken) as jwt.JwtPayload | null;
      const tokenId = decoded?.tid as string | undefined;
      if (!decoded?.sub || !tokenId) {
        res.status(400).json({ error: 'Invalid token' });
        return;
      }

      const record = await verifyRefreshToken(parsed.refreshToken, decoded.sub, tokenId);
      if (record) {
        await revokeRefreshToken(record.id);
        await prisma.auditEvent.create({
          data: {
            userId: decoded.sub,
            type: 'auth.logout',
            context: { tokenId: record.id, sessionId: record.sessionId }
          }
        });
      }

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/status', authenticate, (req, res) => {
    const { userId, sessionId } = req as unknown as AuthenticatedRequest;
    res.json({
      authenticated: true,
      userId,
      sessionId: sessionId ?? null,
      serverTime: new Date().toISOString()
    });
  });
};
