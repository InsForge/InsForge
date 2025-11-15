import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';
import { perEmailCooldown } from '../../src/api/middleware/rate-limiters';
import { AppError } from '../../src/api/middleware/error';

describe('Rate Limit Middleware', () => {
  describe('perEmailCooldown', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      req = {
        body: {},
      };
      res = {};
      next = vi.fn();
    });

    it('allows first request for an email', () => {
      req.body = { email: 'test@example.com' };
      const middleware = perEmailCooldown(60000);

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });

    it('blocks second request within cooldown period', () => {
      req.body = { email: 'test2@example.com' };
      const middleware = perEmailCooldown(60000);

      // First request should pass
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledOnce();

      // Second request should be blocked
      expect(() => {
        middleware(req as Request, res as Response, next);
      }).toThrow(AppError);

      expect(() => {
        middleware(req as Request, res as Response, next);
      }).toThrow(/Please wait.*seconds before requesting another code/);
    });

    it('allows request after cooldown period expires', async () => {
      req.body = { email: 'test3@example.com' };
      const shortCooldown = 100; // 100ms cooldown
      const middleware = perEmailCooldown(shortCooldown);

      // First request
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, shortCooldown + 10));

      // Second request after cooldown should pass
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('treats emails case-insensitively', () => {
      const middleware = perEmailCooldown(60000);
      const uniqueEmail = `case-test-${Date.now()}@example.com`;

      // First request with mixed case
      req.body = { email: uniqueEmail.toUpperCase() };
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledOnce();

      // Second request with lowercase should be blocked
      req.body = { email: uniqueEmail.toLowerCase() };
      expect(() => {
        middleware(req as Request, res as Response, next);
      }).toThrow(AppError);
    });

    it('allows requests for different emails', () => {
      const middleware = perEmailCooldown(60000);

      // Request for first email
      req.body = { email: 'user1@example.com' };
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      // Request for second email should also pass
      req.body = { email: 'user2@example.com' };
      middleware(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('passes through when no email in body', () => {
      req.body = {}; // No email
      const middleware = perEmailCooldown(60000);

      middleware(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith();
    });

    it('calculates remaining cooldown time correctly', () => {
      req.body = { email: 'timing@example.com' };
      const cooldownMs = 60000;
      const middleware = perEmailCooldown(cooldownMs);

      // First request
      middleware(req as Request, res as Response, next);

      // Try second request immediately
      try {
        middleware(req as Request, res as Response, next);
      } catch (error) {
        if (error instanceof AppError) {
          // Should show approximately 60 seconds remaining
          expect(error.message).toMatch(/wait (\d+) seconds/);
          const match = error.message.match(/wait (\d+) seconds/);
          if (match) {
            const seconds = parseInt(match[1]);
            expect(seconds).toBeGreaterThanOrEqual(59);
            expect(seconds).toBeLessThanOrEqual(60);
          }
        }
      }
    });

    it('uses custom cooldown duration', () => {
      req.body = { email: 'custom@example.com' };
      const customCooldown = 30000; // 30 seconds
      const middleware = perEmailCooldown(customCooldown);

      // First request
      middleware(req as Request, res as Response, next);

      // Second request should show 30 second cooldown
      try {
        middleware(req as Request, res as Response, next);
      } catch (error) {
        if (error instanceof AppError) {
          expect(error.message).toMatch(/wait \d+ seconds/);
          const match = error.message.match(/wait (\d+) seconds/);
          if (match) {
            const seconds = parseInt(match[1]);
            expect(seconds).toBeGreaterThanOrEqual(29);
            expect(seconds).toBeLessThanOrEqual(30);
          }
        }
      }
    });
  });
});
