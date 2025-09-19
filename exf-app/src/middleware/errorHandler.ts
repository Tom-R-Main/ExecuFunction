import { NextFunction, Request, Response } from 'express';
import logger from '../config/logger';

type AppError = Error & { statusCode?: number };

const errorHandler = (err: AppError, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  logger.error({ err, status }, 'request failed');
  res.status(status).json({ error: status >= 500 ? 'Internal Server Error' : err.message });
};

export default errorHandler;
