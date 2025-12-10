import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { httpLogger } from './logger';
import { config } from './config';
import { registerAuthRoutes } from './routes/auth';
import { registerSettingsRoutes } from './routes/settings';
import { registerCustomAssignmentRoutes } from './routes/customAssignments';
import { registerAssignmentCheckRoutes } from './routes/assignmentChecks';
import { errorHandler } from './middleware/errorHandler';

export const createApp = () => {
  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.use(httpLogger);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    })
  );

  const router = express.Router();
  registerAuthRoutes(router);
  registerSettingsRoutes(router);
  registerCustomAssignmentRoutes(router);
  registerAssignmentCheckRoutes(router);

  app.use('/api', router);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(errorHandler);

  return app;
};

