import express from 'express';
import helmet from 'helmet';
import requestLogger from './middleware/requestLogger';
import healthRouter from './routes/health';
import errorHandler from './middleware/errorHandler';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.use(healthRouter);

app.get('/configz', (_req, res) => {
  res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use(errorHandler);

export default app;
