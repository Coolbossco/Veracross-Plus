import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma';

export interface AuthenticatedRequest extends Express.Request {
  userId: string;
  sessionId?: string;
}

export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = header.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { sub: string; sessionId?: string };
    const userId = decoded.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (decoded.sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: decoded.sessionId },
        select: { id: true }
      });
      if (!session) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }
    }

    const authReq = req as unknown as AuthenticatedRequest;
    authReq.userId = userId;
    authReq.sessionId = decoded.sessionId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

