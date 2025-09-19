import pinoHttp from 'pino-http';
import logger from '../config/logger';

const requestLogger = pinoHttp({
  logger: logger as any,
  customLogLevel: (_req: any, res: any, err: any) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  }
} as any);

export default requestLogger;
