import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { ScheduleService } from '@/services/schedules/schedule.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createScheduleRequestSchema, updateScheduleRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const scheduleService = ScheduleService.getInstance();

// All schedule routes require authentication
router.use(verifyAdmin);

/**
 * GET /api/schedules
 * List all schedules
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schedules = await scheduleService.listSchedules();
    successResponse(res, schedules);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/schedules/:id
 * Get a single schedule by its ID
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schedule = await scheduleService.getScheduleById(id);
    if (!schedule) {
      throw new AppError('Schedule not found.', 404, ERROR_CODES.NOT_FOUND);
    }
    successResponse(res, schedule);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/schedules/:id/logs
 * Get execution logs for a schedule
 */
router.get('/:id/logs', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await scheduleService.getExecutionLogs(id, limit, offset);
    successResponse(res, {
      logs: result.logs,
      totalCount: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/schedules
 * Create a new schedule
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createScheduleRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await scheduleService.createSchedule(validation.data);
    successResponse(
      res,
      {
        id: result.id,
        cronJobId: result.cron_job_id,
        message: 'Schedule created successfully',
      },
      201
    );
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/schedules/:id
 * Update a schedule (partial update, including toggle)
 */
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const validation = updateScheduleRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await scheduleService.updateSchedule(id, validation.data);
    successResponse(res, {
      id: result.id,
      cronJobId: result.cron_job_id,
      message: 'Schedule updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/schedules/:id
 * Delete a schedule by its ID
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await scheduleService.deleteSchedule(id);
    successResponse(res, { message: 'Schedule deleted successfully.' });
  } catch (error) {
    next(error);
  }
});

export { router as schedulesRouter };
