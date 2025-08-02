import { Router } from 'express';
import { betterAuthHandler } from '../lib/better-auth.js';

const router = Router();

// Mount Better Auth handler at the router level
// This will handle all Better Auth routes like:
// - POST /signup (register)
// - POST /signin (login)
// - GET /user (get current user)
// - POST /signout (logout)
// etc.
router.use('/', betterAuthHandler);

export default router;