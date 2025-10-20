import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '@/api/middleware/auth.js';
import { ScheduleService } from '@/core/schedule/schedule.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  upsertScheduleRequestSchema,
  listSchedulesResponseSchema,
  getScheduleResponseSchema,
  upsertScheduleResponseSchema,
  deleteScheduleResponseSchema,
} from '@insforge/shared-schemas';
import { randomUUID } from 'crypto';

const router = Router();
const scheduleService = ScheduleService.getInstance();

// All schedule routes require authentication
router.use(verifyUser);

/**
 * GET /api/schedules
 * List all schedules
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schedules = await scheduleService.listSchedules();
    // Validate the response against the shared schema
    const schedulesWithStringDates = schedules.map((schedule) => ({
      ...schedule,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    }));
    const validatedResponse = listSchedulesResponseSchema.parse(schedulesWithStringDates);
    successResponse(res, validatedResponse);
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

    const scheduleWithStringDates = {
      ...schedule,
      createdAt: schedule.createdAt.toISOString(),
      updatedAt: schedule.updatedAt.toISOString(),
    };
    // Validate the response against the shared schema
    const validatedResponse = getScheduleResponseSchema.parse(scheduleWithStringDates);
    successResponse(res, validatedResponse);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/schedules
 * Create or update a schedule (upsert)
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = upsertScheduleRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { data } = validation;
    const scheduleId = data.id || randomUUID();

    const result = await scheduleService.upsertSchedule({
      scheduleId,
      name: data.name,
      cronSchedule: data.cronSchedule,
      functionUrl: data.functionUrl,
      httpMethod: data.httpMethod,
      headers: data.headers,
      body: data.body,
    });

    const responsePayload = {
      id: scheduleId,
      // The cron_job_id from the DB function is a string (BIGINT)
      cronJobId: result.cron_job_id,
      message: 'Schedule processed successfully',
    };

    // Validate the response against the shared schema
    const validatedResponse = upsertScheduleResponseSchema.parse(responsePayload);

    successResponse(res, validatedResponse, 201);
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

    const responsePayload = { message: 'Schedule deleted successfully.' };

    // Validate the response against the shared schema
    const validatedResponse = deleteScheduleResponseSchema.parse(responsePayload);
    successResponse(res, validatedResponse);
  } catch (error) {
    next(error);
  }
});

export { router as schedulesRouter };
