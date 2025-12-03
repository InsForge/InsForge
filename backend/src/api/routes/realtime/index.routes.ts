import { Router } from 'express';
import { channelsRouter } from './channels.routes.js';
import { messagesRouter } from './messages.routes.js';
import { permissionsRouter } from './permissions.routes.js';

const router = Router();

router.use('/channels', channelsRouter);
router.use('/messages', messagesRouter);
router.use('/permissions', permissionsRouter);

export { router as realtimeRouter };
