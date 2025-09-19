import pino from 'pino';
import env from './env';

const logger = pino({
  level: env.logLevel,
  base: { service: 'execufunction-backend', build: env.buildSha },
  transport: env.nodeEnv === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined
});

export default logger;
