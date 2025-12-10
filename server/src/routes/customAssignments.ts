import type { Router } from 'express';
import { prisma } from '../prisma';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth';
import {
  customAssignmentCreateSchema,
  customAssignmentUpdateSchema,
  customAssignmentsSyncSchema
} from '../validators';

export const registerCustomAssignmentRoutes = (router: Router) => {
  router.get('/custom-assignments', authenticate, async (req, res, next) => {
    try {
      const { userId } = req as unknown as AuthenticatedRequest;
      const assignments = await prisma.customAssignment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      res.json(assignments);
    } catch (error) {
      next(error);
    }
  });

  router.post('/custom-assignments', authenticate, async (req, res, next) => {
    try {
      const payload = customAssignmentCreateSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;
      const created = await prisma.customAssignment.create({
        data: {
          userId,
          ...payload,
          dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined
        }
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.put('/custom-assignments', authenticate, async (req, res, next) => {
    try {
      const { assignments } = customAssignmentsSyncSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;

      const normalizedAssignments = assignments.map((assignment) => ({
        ...assignment,
        dueDate: assignment.dueDate ? new Date(assignment.dueDate) : null,
        description: assignment.description ?? null,
        courseName: assignment.courseName ?? null,
        status: assignment.status ?? 'pending',
        externalId: assignment.externalId ?? null
      }));

      const existing = await prisma.customAssignment.findMany({
        where: { userId }
      });

      const incomingMap = new Map(normalizedAssignments.map((assignment) => [assignment.id, assignment]));
      const existingMap = new Map(existing.map((assignment) => [assignment.id, assignment]));

      const toDeleteIds = existing
        .filter((assignment) => !incomingMap.has(assignment.id))
        .map((assignment) => assignment.id);

      const toCreate = normalizedAssignments.filter((assignment) => !existingMap.has(assignment.id));

      const toUpdate = normalizedAssignments.filter((assignment) => {
        const current = existingMap.get(assignment.id);
        if (!current) return false;

        const currentDue = current.dueDate ? current.dueDate.getTime() : null;
        const incomingDue = assignment.dueDate ? assignment.dueDate.getTime() : null;

        return (
          current.title !== assignment.title ||
          (current.description ?? null) !== assignment.description ||
          (current.courseName ?? null) !== assignment.courseName ||
          currentDue !== incomingDue ||
          (current.status ?? 'pending') !== assignment.status ||
          (current.externalId ?? null) !== assignment.externalId
        );
      });

      await prisma.$transaction(async (tx) => {
        if (toDeleteIds.length) {
          await tx.customAssignment.deleteMany({
            where: {
              userId,
              id: { in: toDeleteIds }
            }
          });
        }

        if (toCreate.length) {
          await tx.customAssignment.createMany({
            data: toCreate.map((assignment) => ({
              userId,
              id: assignment.id,
              title: assignment.title,
              description: assignment.description,
              courseName: assignment.courseName,
              dueDate: assignment.dueDate,
              status: assignment.status,
              externalId: assignment.externalId
            })),
            skipDuplicates: true
          });
        }

        for (const assignment of toUpdate) {
          await tx.customAssignment.update({
            where: { id: assignment.id },
            data: {
              title: assignment.title,
              description: assignment.description,
              courseName: assignment.courseName,
              dueDate: assignment.dueDate,
              status: assignment.status,
              externalId: assignment.externalId
            }
          });
        }
      });

      res.json({
        created: toCreate.length,
        updated: toUpdate.length,
        deleted: toDeleteIds.length
      });
    } catch (error) {
      next(error);
    }
  });

  router.put('/custom-assignments/:id', authenticate, async (req, res, next) => {
    try {
      const payload = customAssignmentUpdateSchema.parse(req.body);
      const { userId } = req as unknown as AuthenticatedRequest;
      const { id } = req.params;

      const existing = await prisma.customAssignment.findFirst({
        where: { id, userId }
      });

      if (!existing) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }

      const updated = await prisma.customAssignment.update({
        where: { id },
        data: {
          ...payload,
          dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined
        }
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete('/custom-assignments/:id', authenticate, async (req, res, next) => {
    try {
      const { userId } = req as unknown as AuthenticatedRequest;
      const { id } = req.params;

      const existing = await prisma.customAssignment.findFirst({
        where: { id, userId }
      });

      if (!existing) {
        res.status(404).json({ error: 'Assignment not found' });
        return;
      }

      await prisma.customAssignment.delete({ where: { id } });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });
};

