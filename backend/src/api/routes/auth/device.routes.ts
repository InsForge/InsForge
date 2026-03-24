import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  approveDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationResponseSchema,
  denyDeviceAuthorizationRequestSchema,
  exchangeDeviceAuthorizationRequestSchema,
  type CreateDeviceAuthorizationResponse,
  type DeviceAuthorizationSessionSchema,
} from '@insforge/shared-schemas';
import { DeviceAuthorizationService } from '@/services/auth/device-authorization.service.js';
import { AuthService } from '@/services/auth/auth.service.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { errorResponse, successResponse } from '@/utils/response.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import { extractBearerToken, verifyToken, type AuthRequest } from '@/api/middlewares/auth.js';
import {
  deviceAuthorizationCreationLimiter,
  deviceAuthorizationPollingLimiter,
  deviceAuthorizationUserCodeLimiter,
} from '@/api/middlewares/rate-limiters.js';

const router = Router();
const deviceAuthorizationService = DeviceAuthorizationService.getInstance();
const authService = AuthService.getInstance();
const tokenManager = TokenManager.getInstance();

function buildVerificationUrls(
  userCode: string
): Pick<CreateDeviceAuthorizationResponse, 'verificationUri' | 'verificationUriComplete'> {
  const verificationUri = new URL('/auth/device', getApiBaseUrl()).toString();
  const verificationUriComplete = new URL(verificationUri);
  verificationUriComplete.searchParams.set('user_code', userCode);

  return {
    verificationUri,
    verificationUriComplete: verificationUriComplete.toString(),
  };
}

function buildDeviceAuthorizationResponse(
  session: Awaited<ReturnType<typeof deviceAuthorizationService.create>>
): CreateDeviceAuthorizationResponse {
  const { verificationUri, verificationUriComplete } = buildVerificationUrls(session.userCode);
  const expiresIn = Math.max(1, Math.ceil((Date.parse(session.expiresAt) - Date.now()) / 1000));

  return createDeviceAuthorizationResponseSchema.parse({
    deviceCode: session.deviceCode,
    userCode: session.userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval: session.pollIntervalSeconds,
  });
}

type DeviceAuthorizationLookupResponse = Pick<
  DeviceAuthorizationSessionSchema,
  'status' | 'expiresAt'
> &
  Partial<Pick<DeviceAuthorizationSessionSchema, 'clientContext'>>;

type DeviceAuthorizationLookupSession = NonNullable<
  Awaited<ReturnType<typeof deviceAuthorizationService.findByUserCode>>
>;

function buildDeviceAuthorizationLookupResponse(
  session: DeviceAuthorizationLookupSession,
  includeClientContext = false
): DeviceAuthorizationLookupResponse {
  const response: DeviceAuthorizationLookupResponse = {
    status: session.status,
    expiresAt: session.expiresAt,
  };

  if (includeClientContext) {
    response.clientContext = session.clientContext ?? null;
  }

  return response;
}

function resolveLookupUser(req: Request): AuthRequest['user'] | null {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return null;
  }

  try {
    const payload = tokenManager.verifyToken(token);

    if (!payload.role) {
      throw new AppError('Invalid token: missing role', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Invalid token', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
  }
}

function mapDeviceTokenError(
  error: unknown
): { error: string; message: string; statusCode: number } | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = String((error as { code?: string }).code ?? '');

  switch (code) {
    case ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_PENDING:
      return {
        error: 'authorization_pending',
        message: 'Device authorization is still pending approval.',
        statusCode: 428,
      };
    case ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_DENIED:
      return {
        error: 'access_denied',
        message: 'Device authorization was denied.',
        statusCode: 403,
      };
    case ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_EXPIRED:
      return {
        error: 'expired_token',
        message: 'Device authorization expired.',
        statusCode: 400,
      };
    case ERROR_CODES.AUTH_DEVICE_AUTHORIZATION_CONSUMED:
      return {
        error: 'already_used',
        message: 'Device authorization has already been used.',
        statusCode: 400,
      };
    case ERROR_CODES.NOT_FOUND:
      return {
        error: 'invalid_grant',
        message: 'Device authorization not found.',
        statusCode: 400,
      };
    default:
      return undefined;
  }
}

router.post(
  '/authorizations',
  deviceAuthorizationCreationLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = createDeviceAuthorizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const session = await deviceAuthorizationService.create(validationResult.data);
      successResponse(res, buildDeviceAuthorizationResponse(session));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/token',
  deviceAuthorizationPollingLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = exchangeDeviceAuthorizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const session = await authService.exchangeApprovedDeviceAuthorization(
        validationResult.data.deviceCode
      );
      const refreshToken = tokenManager.generateRefreshToken(session.user.id);

      successResponse(res, {
        ...session,
        refreshToken,
      });
    } catch (error) {
      const mapped = mapDeviceTokenError(error);
      if (mapped) {
        errorResponse(res, mapped.error, mapped.message, mapped.statusCode);
        return;
      }

      next(error);
    }
  }
);

router.post(
  '/authorizations/approve',
  verifyToken,
  deviceAuthorizationUserCodeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const validationResult = approveDeviceAuthorizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const session = await deviceAuthorizationService.approve(
        validationResult.data.userCode,
        req.user.id
      );

      successResponse(res, buildDeviceAuthorizationLookupResponse(session, true));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/authorizations/lookup',
  deviceAuthorizationUserCodeLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validationResult = approveDeviceAuthorizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const lookupUser = resolveLookupUser(req);
      const session = lookupUser
        ? await deviceAuthorizationService.markAuthenticated(
            validationResult.data.userCode,
            lookupUser.id
          )
        : await deviceAuthorizationService.findByUserCode(validationResult.data.userCode);
      if (!session) {
        throw new AppError('Device authorization not found', 404, ERROR_CODES.NOT_FOUND);
      }

      successResponse(res, buildDeviceAuthorizationLookupResponse(session, Boolean(lookupUser)));
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/authorizations/deny',
  verifyToken,
  deviceAuthorizationUserCodeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('User not authenticated', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      const validationResult = denyDeviceAuthorizationRequestSchema.safeParse(req.body);
      if (!validationResult.success) {
        throw new AppError(
          validationResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const session = await deviceAuthorizationService.deny(
        validationResult.data.userCode,
        req.user.id
      );

      successResponse(res, buildDeviceAuthorizationLookupResponse(session, true));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
