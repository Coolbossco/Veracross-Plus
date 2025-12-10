import jwt, { type SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import ms from 'ms';
import { config, createRandomToken } from '../config';
import { prisma } from '../prisma';

export const createAccessToken = (userId: string, sessionId?: string): string => {
  const options: SignOptions = {
    subject: userId,
    expiresIn: config.accessTokenTtl as any,
    issuer: config.tokenIssuer
  };

  return jwt.sign(
    {
      sessionId
    },
    config.jwtSecret,
    options
  );
};

export const createRefreshToken = async (userId: string, sessionId?: string) => {
  const tokenId = createRandomToken(16);
  const payload = {
    tid: tokenId,
    sessionId
  };

  const options: SignOptions = {
    subject: userId,
    expiresIn: config.refreshTokenTtl as any,
    issuer: config.tokenIssuer
  };

  const rawToken = jwt.sign(payload, config.refreshTokenSecret, options);

  const hash = await bcrypt.hash(rawToken, config.bcryptRounds);
  const refreshTtlMs = Number(ms(config.refreshTokenTtl as any));
  const expiresAt = new Date(Date.now() + refreshTtlMs);

  await prisma.refreshToken.create({
    data: {
      id: tokenId,
      userId,
      sessionId,
      hash,
      expiresAt
    }
  });

  return { rawToken, expiresAt };
};

export const verifyRefreshToken = async (token: string, userId: string, tokenId?: string | null) => {
  if (!tokenId) {
    return null;
  }

  const record = await prisma.refreshToken.findUnique({
    where: {
      id: tokenId
    }
  });

  if (!record || record.userId !== userId || record.revoked || record.expiresAt <= new Date()) {
    return null;
  }

  const match = await bcrypt.compare(token, record.hash);
  return match ? record : null;
};

export const revokeRefreshToken = async (id: string) => {
  await prisma.refreshToken.updateMany({
    where: { id },
    data: { revoked: true }
  });
};

