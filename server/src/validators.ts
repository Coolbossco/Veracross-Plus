import { z } from 'zod';

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(8).max(256);
const deviceIdSchema = z.string().min(4).max(128);

export const authSignupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  deviceId: deviceIdSchema.optional(),
  userAgent: z.string().max(512).optional()
});

export const authLoginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  deviceId: deviceIdSchema.optional(),
  userAgent: z.string().max(512).optional()
});

export const authRefreshSchema = z.object({
  refreshToken: z.string().min(10)
});

export const authLogoutSchema = z.object({
  refreshToken: z.string().min(10)
});

export const settingsUpdateSchema = z.object({
  notificationsEnabled: z.boolean().optional(),
  syncEnabled: z.boolean().optional(),
  preferences: z.record(z.any()).optional()
});

const dateLikeString = z
  .string()
  .min(4)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid date string'
  });

export const customAssignmentCreateSchema = z.object({
  id: z.string().min(5).max(64).optional(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  courseName: z.string().max(255).optional(),
  dueDate: dateLikeString.optional(),
  status: z.enum(['pending', 'completed', 'hidden']).optional(),
  externalId: z.string().max(255).optional()
});

export const customAssignmentUpdateSchema = customAssignmentCreateSchema.partial();

export const assignmentCheckCreateSchema = z.object({
  assignmentId: z.string().max(255).optional(),
  assignmentDate: z.string().datetime(),
  status: z.enum(['success', 'failure', 'skipped']),
  metadata: z.record(z.any()).optional()
});

const customAssignmentSyncItemSchema = customAssignmentCreateSchema.extend({
  id: z.string().min(5).max(64)
});

export const customAssignmentsSyncSchema = z.object({
  assignments: z.array(customAssignmentSyncItemSchema).max(500).default([])
});

export const assignmentChecksSyncSchema = z.object({
  assignmentIds: z.array(z.string().min(1).max(255)).max(500).default([]),
  assignmentDate: z.string().datetime().optional(),
  status: z.enum(['success', 'failure', 'skipped']).optional(),
  metadata: z.record(z.any()).optional()
});

