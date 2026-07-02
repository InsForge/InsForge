import { Router, Response, NextFunction } from 'express';
import axios from 'axios';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { validateFunctionName } from '@/utils/validations.js';
import { successResponse } from '@/utils/response.js';
import { PostgrestProxyService } from '@/services/database/postgrest-proxy.service.js';
import { resolvePostgrestSchema } from '@/services/database/helpers.js';

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

    // Resolve the target schema the native PostgREST way: ?schema= is desugared
    // into the profile header (RPC uses Content-Profile for POST, Accept-Profile
    // for GET) and stripped from the forwarded query; a client-sent profile
    // header is honored as-is.
    const { query: forwardedQuery, headers: forwardedHeaders } = resolvePostgrestSchema(
      req.method,
      req.query as Record<string, unknown>,
      req.headers as Record<string, string | string[] | undefined>
    );

    const proxyRequest = {
      method: req.method,
      path: `/rpc/${functionName}`,
      query: forwardedQuery,
      headers: forwardedHeaders,
      body: req.body,
    };

    const result =
      req.user?.role === 'project_admin' || req.hasApiKey === true
        ? await proxyService.forwardAsAdmin(proxyRequest)
        : req.user && req.user.role !== 'anon'
          ? await proxyService.forwardAsUser(proxyRequest, req.user)
          : await proxyService.forwardAsAnon(proxyRequest);

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

router.all('/:functionName', verifyUser, forwardRpcToPostgrest);

export { router as databaseRpcRouter };
