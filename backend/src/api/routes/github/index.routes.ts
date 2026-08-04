import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { GitHubService } from '@/services/github/github.service.js';

const router = Router();
const gitHubService = GitHubService.getInstance();

router.use(verifyAdmin);

/**
 * GET /api/github/repository
 * Returns cached GitHub repository metadata.
 */
router.get('/repository', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const metadata = await gitHubService.getRepositoryMetadata();
    successResponse(res, metadata);
  } catch (error) {
    next(error);
  }
});

export { router as githubRouter };
