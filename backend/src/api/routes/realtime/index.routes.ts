import { Router } from 'express';
import { channelsRouter } from './channels.routes.js';
import { messagesRouter } from './messages.routes.js';

const router = Router();

router.use('/channels', channelsRouter);
router.use('/messages', messagesRouter);

export { router as realtimeRouter };
