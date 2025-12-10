import type { Router } from 'express';
import { prisma } from '../prisma';
import type { AuthenticatedRequest } from '../middleware/auth';
import { authenticate } from '../middleware/auth';
import { settingsUpdateSchema } from '../validators';

export const registerSettingsRoutes = (router: Router) => {
  router.get('/settings', authenticate, async (req, res, next) => {
    try {
      const { userId } = req as unknown as AuthenticatedRequest;
      const settings = await prisma.userSettings.upsert({
        where: { userId },
        create: { userId },
        update: {}
      });

      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  router.put('/settings', authenticate, async (req, res, next) => {
    try {
      const payload = settingsUpdateSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;

      const updated = await prisma.userSettings.upsert({
        where: { userId },
        update: payload,
        create: {
          userId,
          ...payload
        }
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });
};

