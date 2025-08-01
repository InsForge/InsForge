import { Router, Request, Response, NextFunction } from 'express';
import { VaultService } from '../services/vault.js';
import { DatabaseManager } from '../services/database.js';
import { AppError } from '../middleware/error.js';
import { verifyAdmin, verifyApiKey, AuthRequest } from '../middleware/auth.js';
import { successResponse } from '../utils/response.js';
import { ERROR_CODES } from '../types/error-constants.js';

const router = Router();
const dbManager = DatabaseManager.getInstance();
const vaultService = new VaultService(dbManager);

// Custom middleware to verify admin OR API key
async function verifyAdminOrApiKey(req: AuthRequest, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string;
  const authHeader = req.headers.authorization;
  
  if (apiKey) {
    // Try API key authentication
    return verifyApiKey(req, res, next);
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    // Try admin authentication
    return verifyAdmin(req, res, next);
  } else {
    next(new AppError(
      'Admin access or API key required',
      401,
      ERROR_CODES.AUTH_UNAUTHORIZED,
      'You must be an admin or provide a valid API key to access vault endpoints'
    ));
  }
}

// Apply auth middleware to all vault routes
router.use(verifyAdminOrApiKey);

// GET /api/vault - Get all secret names
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // For API key access, we'll return all secrets (admin view)
    // For admin users, we'll also return all secrets
    const secrets = await vaultService.getAllSecretsAdmin();
    return successResponse(res, secrets);
  } catch (error) {
    next(error);
  }
});

// GET /api/vault/:name - Get a specific secret
router.get('/:name', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const secret = await vaultService.getSecretAdmin(name);
    
    if (!secret) {
      throw new AppError('Secret not found', 404, ERROR_CODES.NOT_FOUND);
    }
    
    return successResponse(res, secret);
  } catch (error) {
    next(error);
  }
});

// POST /api/vault - Create or update a secret
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, value, description } = req.body;
    
    if (!name || !value) {
      throw new AppError(
        'Name and value are required', 
        400, 
        ERROR_CODES.MISSING_FIELD,
        'Please provide both name and value for the secret'
      );
    }
    
    // Use admin version that handles user tracking internally
    const result = await vaultService.upsertSecretAdmin(name, value, description || null);
    return successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/vault/:name - Delete a secret
router.delete('/:name', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const deleted = await vaultService.deleteSecretAdmin(name);
    
    if (!deleted) {
      throw new AppError('Secret not found', 404, ERROR_CODES.NOT_FOUND);
    }
    
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// GET /api/vault/:name/functions - Get functions using a secret
router.get('/:name/functions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name } = req.params;
    const functions = await vaultService.getSecretFunctionsAdmin(name);
    
    return successResponse(res, functions);
  } catch (error) {
    next(error);
  }
});

export { router as vaultRouter };