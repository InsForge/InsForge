import type { Request, Response, NextFunction } from 'express';
import { readLiveConfig } from '@/services/config/read.js';
import { successResponse } from '@/utils/response.js';

export async function handleGetConfig(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const config = await readLiveConfig();
    successResponse(res, { config });
  } catch (err) {
    next(err);
  }
}
