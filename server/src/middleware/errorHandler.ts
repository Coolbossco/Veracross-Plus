import type { ErrorRequestHandler } from 'express';
import { logger } from '../logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  logger.error({ err, path: req.path }, 'Unhandled error');
  const status = err.status ?? 500;
  res.status(status).json({
    error: err.message ?? 'Internal server error'
  });
};

