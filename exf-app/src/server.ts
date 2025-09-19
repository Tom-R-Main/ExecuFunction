import env from './config/env';
import logger from './config/logger';
import app from './app';

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'ExecuFunction backend listening');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down');
  server.close(() => {
    logger.info('HTTP server closed');
  });
});
