import { Router, Request, Response, NextFunction } from 'express';
import { ProfileService } from '@/core/auth/profile.js';
import { AuthService } from '@/core/auth/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { verifyUser, AuthRequest } from '@/api/middleware/auth.js';
import { successResponse } from '@/utils/response.js';
import { UpdateProfileRequest } from '@/types/profile.js';
import { ERROR_CODES } from '@/types/error-constants.js';

const router = Router();
const profileService = new ProfileService();
const authService = AuthService.getInstance();

// Get current user's profile
router.get('/me', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // verifyUser middleware already checks for user, but we need to check again for type safety
    if (!req.user) {
      throw new AppError(
        'User not authenticated',
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        'Please authenticate before accessing this endpoint'
      );
    }
    const profile = await profileService.getProfileByAuthId(req.user.id);

    if (!profile) {
      throw new AppError(
        'Profile not found',
        404,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        'Please check the user id, it must be a valid user id, or you can call login first'
      );
    }

    successResponse(res, profile);
  } catch (error) {
    next(error);
  }
});

// Update current user's profile
router.patch('/me', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // verifyUser middleware already checks for user, but we need to check again for type safety
    if (!req.user) {
      throw new AppError(
        'User not authenticated',
        401,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        'Please authenticate before accessing this endpoint'
      );
    }
    const updates: UpdateProfileRequest = req.body;
    const profile = await profileService.updateProfile(req.user.id, updates);

    if (!profile) {
      throw new AppError(
        'Profile not found',
        404,
        ERROR_CODES.AUTH_UNAUTHORIZED,
        'Please check the user id, it must be a valid user id, or you can call login first'
      );
    }

    successResponse(res, profile);
  } catch (error) {
    next(error);
  }
});

// Search profiles
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      throw new AppError('Search query is required', 400, ERROR_CODES.MISSING_FIELD);
    }

    const profiles = await profileService.searchProfiles(q);

    // Return public profile data only
    successResponse(
      res,
      profiles.map((profile) => ({
        id: profile.id,
        auth_id: profile.auth_id,
        name: profile.name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        created_at: profile.created_at,
      }))
    );
  } catch (error) {
    next(error);
  }
});

// Get profile by user ID (public endpoint)
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.params;

    // Get user to verify they exist
    const user = await authService.getUserById(userId);
    if (!user) {
      throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const profile = await profileService.getProfileByAuthId(userId);

    if (!profile) {
      throw new AppError('Profile not found', 404, ERROR_CODES.NOT_FOUND);
    }

    // Return public profile data only
    successResponse(res, {
      id: profile.id,
      name: profile.name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      created_at: profile.created_at,
    });
  } catch (error) {
    next(error);
  }
});

export { router as profileRouter };
