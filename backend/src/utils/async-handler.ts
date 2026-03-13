import { Request, Response, NextFunction } from 'express';

/**
 * Type for Express request handler
 */
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/**
 * Wrapper for async Express route handlers to catch errors and pass them to next()
 * This eliminates the need for try-catch blocks in every route handler
 * 
 * @param fn - Async route handler function
 * @returns Express route handler with error handling
 * 
 * @example
 * // Without wrapper (requires try-catch)
 * app.get('/users', async (req, res, next) => {
 *   try {
 *     const users = await db.users.findMany();
 *     res.json(users);
 *   } catch (error) {
 *     next(error);
 *   }
 * });
 * 
 * @example
 * // With wrapper (cleaner)
 * app.get('/users', asyncHandler(async (req, res) => {
 *   const users = await db.users.findMany();
 *   res.json(users);
 * }));
 */
export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Type for async function that returns a value
 */
type AsyncFunction<T = any> = () => Promise<T>;

/**
 * Execute an async function with error handling
 * Returns a tuple of [error, result] similar to Go's error handling pattern
 * 
 * @param fn - Async function to execute
 * @returns Tuple of [error, result] where error is null on success and result is null on error
 * 
 * @example
 * const [error, user] = await executeAsync(async () => {
 *   return await db.users.findById(userId);
 * });
 * 
 * if (error) {
 *   return errorResponse(res, 'NOT_FOUND', 'User not found');
 * }
 * 
 * return successResponse(res, user);
 */
export async function executeAsync<T>(fn: AsyncFunction<T>): Promise<[Error, null] | [null, T]> {
  try {
    const result = await fn();
    return [null, result];
  } catch (error) {
    return [error as Error, null];
  }
}

/**
 * Retry an async function with exponential backoff
 * 
 * @param fn - Async function to retry
 * @param options - Retry options
 * @param options.maxRetries - Maximum number of retries (default: 3)
 * @param options.initialDelay - Initial delay in ms (default: 100)
 * @param options.maxDelay - Maximum delay in ms (default: 10000)
 * @param options.backoff - Backoff multiplier (default: 2)
 * @returns Promise that resolves to the function result
 * @throws The last error if all retries fail
 * 
 * @example
 * const result = await retryAsync(
 *   async () => await fetchExternalAPI(),
 *   { maxRetries: 5, initialDelay: 200 }
 * );
 */
export async function retryAsync<T>(
  fn: AsyncFunction<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoff?: number;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 100,
    maxDelay = 10000,
    backoff = 2,
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break;
      }

      // Wait before retrying with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoff, maxDelay);
    }
  }

  throw lastError!;
}

/**
 * Timeout wrapper for async functions
 * 
 * @param fn - Async function to wrap with timeout
 * @param ms - Timeout in milliseconds
 * @returns Promise that resolves to the function result
 * @throws Error if the function takes longer than the timeout
 * 
 * @example
 * const result = await withTimeout(
 *   async () => await slowOperation(),
 *   5000 // 5 second timeout
 * );
 */
export async function withTimeout<T>(fn: AsyncFunction<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);
}
