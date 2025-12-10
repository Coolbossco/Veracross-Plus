import type { Router } from 'express';
import { prisma } from '../prisma';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth';
import { assignmentCheckCreateSchema, assignmentChecksSyncSchema } from '../validators';

export const registerAssignmentCheckRoutes = (router: Router) => {
  router.get('/assignment-checks', authenticate, async (req, res, next) => {
    try {
      const { userId } = req as unknown as AuthenticatedRequest;
      const checks = await prisma.assignmentCheck.findMany({
        where: { userId },
        orderBy: {
          assignmentDate: 'desc'
        },
        take: Number(req.query.limit ?? 100)
      });
      res.json(checks);
    } catch (error) {
      next(error);
    }
  });

  router.post('/assignment-checks', authenticate, async (req, res, next) => {
    try {
      const payload = assignmentCheckCreateSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;

      const created = await prisma.assignmentCheck.create({
        data: {
          userId,
          ...payload,
          assignmentDate: new Date(payload.assignmentDate)
        }
      });

      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.put('/assignment-checks', authenticate, async (req, res, next) => {
    try {
      const { assignmentIds, assignmentDate, status = 'success', metadata } =
        assignmentChecksSyncSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;

      const uniqueIds = Array.from(
        new Set((assignmentIds || []).filter((id) => typeof id === 'string' && id.trim().length > 0))
      );

      const timestamp = assignmentDate ? new Date(assignmentDate) : new Date();
      const assignmentMetadata = metadata ?? { checked: true };

      const existing = await prisma.assignmentCheck.findMany({
        where: { userId },
        select: { id: true, assignmentId: true }
      });

      const existingWithAssignmentId = existing.filter(
        (item): item is { id: string; assignmentId: string } => !!item.assignmentId
      );
      const orphanRecordIds = existing
        .filter((item) => !item.assignmentId)
        .map((item) => item.id);

      const existingMap = new Map(existingWithAssignmentId.map((item) => [item.assignmentId, item.id]));
      const targetSet = new Set(uniqueIds);

      const toDeleteIds = [
        ...orphanRecordIds,
        ...existingWithAssignmentId
          .filter((item) => !targetSet.has(item.assignmentId))
          .map((item) => item.id)
      ];

      const toUpdateIds = existingWithAssignmentId
        .filter((item) => targetSet.has(item.assignmentId))
        .map((item) => item.assignmentId);

      const toCreateIds = uniqueIds.filter((assignmentId) => !existingMap.has(assignmentId));

      const operations = [];

      if (toDeleteIds.length) {
        operations.push(
          prisma.assignmentCheck.deleteMany({
            where: { id: { in: toDeleteIds } }
          })
        );
      }

      if (toUpdateIds.length) {
        operations.push(
          prisma.assignmentCheck.updateMany({
            where: {
              userId,
              assignmentId: { in: toUpdateIds }
            },
            data: {
              assignmentDate: timestamp,
              status,
              metadata: assignmentMetadata
            }
          })
        );
      }

      if (toCreateIds.length) {
        operations.push(
          prisma.assignmentCheck.createMany({
            data: toCreateIds.map((assignmentId) => ({
              userId,
              assignmentId,
              assignmentDate: timestamp,
              status,
              metadata: assignmentMetadata
            })),
            skipDuplicates: true
          })
        );
      }

      if (operations.length) {
        await prisma.$transaction(operations);
      }

      res.json({
        created: toCreateIds.length,
        updated: toUpdateIds.length,
        deleted: toDeleteIds.length
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/assignment-checks/:assignmentId', authenticate, async (req, res, next) => {
    try {
      const payload = assignmentCheckCreateSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;
      const { assignmentId } = req.params;

      const existing = await prisma.assignmentCheck.findUnique({
        where: {
          userId_assignmentId: {
            userId,
            assignmentId
          }
        }
      });

      const data = {
        userId,
        assignmentId,
        ...payload,
        assignmentDate: new Date(payload.assignmentDate)
      };

      const result = existing
        ? await prisma.assignmentCheck.update({
            where: { id: existing.id },
            data
          })
        : await prisma.assignmentCheck.create({
            data
          });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/assignment-checks/:assignmentId', authenticate, async (req, res, next) => {
    try {
      const { userId } = req as unknown as AuthenticatedRequest;
      const { assignmentId } = req.params;

      const existing = await prisma.assignmentCheck.findUnique({
        where: {
          userId_assignmentId: {
            userId,
            assignmentId
          }
        }
      });

      if (!existing) {
        res.status(204).send();
        return;
      }

      await prisma.assignmentCheck.delete({ where: { id: existing.id } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
};

