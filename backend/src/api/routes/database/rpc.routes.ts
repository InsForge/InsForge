import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest, extractApiKey } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { validateFunctionName } from '@/utils/validations.js';
import { successResponse } from '@/utils/response.js';
import { PostgrestProxyService } from '@/services/database/postgrest-proxy.service.js';

const router = Router();
const proxyService = PostgrestProxyService.getInstance();

/**
 * Helper to handle PostgREST proxy errors
 */
function handleProxyError(error: unknown, res: Response, next: NextFunction) {
  if (axios.isAxiosError(error) && error.response) {
    res.status(error.response.status).json(error.response.data);
  } else {
    next(error);
  }
}

/**
 * Forward RPC calls to PostgREST
 */
const forwardRpcToPostgrest = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { functionName } = req.params;

  try {
    // Validate function name
    try {
      validateFunctionName(functionName);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(`Invalid function name: ${functionName}`, 400, ERROR_CODES.INVALID_INPUT);
    }

    const result = await proxyService.forward({
      method: req.method,
      path: `/rpc/${functionName}`,
      query: req.query as Record<string, unknown>,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      apiKey: extractApiKey(req) ?? undefined,
    });

    const headers = PostgrestProxyService.filterHeaders(result.headers);
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

    let responseData = result.data;
    if (
      result.data === undefined ||
      (typeof result.data === 'string' && result.data.trim() === '')
    ) {
      responseData = null;
    }

    successResponse(res, responseData, result.status);
  } catch (error) {
    handleProxyError(error, res, next);
  }
};

router.all('/:functionName', forwardRpcToPostgrest);

export { router as databaseRpcRouter };
