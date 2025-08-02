import { Router } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { auth } from '@/lib/better-auth.js';

const router = Router();

// Mount Better Auth handler
// Handles all Better Auth routes: sign-up, sign-in, token, jwks, etc.
router.all('/*', toNodeHandler(auth));

export default router;
