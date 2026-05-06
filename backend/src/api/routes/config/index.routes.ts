import { Router } from 'express';
import { verifyAdmin } from '@/api/middlewares/auth.js';
import { handleGetConfig } from './get.js';
import { handleApplyConfig } from './apply.js';

export function configRouter(): Router {
  const r = Router();
  // GET /api/config — return live project config in JSON shape.
  r.get('/', verifyAdmin, handleGetConfig);
  // POST /api/config/apply — diff incoming config vs live, apply if !dry_run.
  r.post('/apply', verifyAdmin, handleApplyConfig);
  return r;
}
