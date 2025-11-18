import { Router, Request, Response } from 'express';
import { AgentAPIDocService } from '@/services/documentation/agent.service.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';

const router = Router();
const agentAPIDocService = AgentAPIDocService.getInstance();

/**
 * GET /api/agent-docs
 * Get AI-native API documentation optimized for LLMs
 */
router.get('/', async (_req: Request, res: Response, next) => {
  try {
    const agentDocs = await agentAPIDocService.generateAgentDocumentation();
    successResponse(res, agentDocs);
  } catch (error) {
    logger.error('Failed to generate agent API documentation', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(
      new AppError('Failed to generate agent API documentation', 500, ERROR_CODES.INTERNAL_ERROR)
    );
  }
});

export { router as agentDocsRouter };
