import { Router } from 'express';
import env from '../config/env';

const router = Router();

router.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/readyz', (_req, res) => {
  res.status(200).json({ ready: true });
});

router.get('/version', (_req, res) => {
  res.status(200).json({ build: env.buildSha });
});

export default router;
