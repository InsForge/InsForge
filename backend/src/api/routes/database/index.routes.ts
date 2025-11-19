import { Router } from 'express';
import { databaseTablesRouter } from './tables.routes.js';
import { databaseRecordsRouter } from './records.routes.js';
import databaseAdvanceRouter from './advance.routes.js';

const router = Router();

// Mount database sub-routes
router.use('/tables', databaseTablesRouter);
router.use('/records', databaseRecordsRouter);
router.use('/advance', databaseAdvanceRouter);

export default router;
