import 'dotenv/config';
import { createServer } from 'node:http';
import { createApp } from './app';
import { logger } from './logger';
import { prisma } from './prisma';

const port = Number(process.env.PORT ?? 4000);

const main = async () => {
  const app = createApp();
  const server = createServer(app);

  server.listen(port, () => {
    logger.info({ port }, 'Remote sync API listening');
  });
};

main().catch((error) => {
  logger.error({ error }, 'Failed to start server');
  prisma.$disconnect().catch(() => {
    logger.warn('Failed to disconnect prisma');
  });
  process.exit(1);
});

