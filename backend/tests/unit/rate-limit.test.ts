import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import {
  applyApiRateLimitConfig,
  cleanupRateLimitEntries,
  clearRateLimitState,
  perEmailCooldown,
  sendEmailOTPRateLimiter,
  verifyOTPRateLimiter,
} from '../../src/api/middlewares/rate-limiters';
import { AppError } from '../../src/api/middlewares/error';

describe('Rate Limit Middleware', () => {
  beforeEach(() => {
    clearRateLimitState();
    applyApiRateLimitConfig({
      overallApiMaxRequests: 3000,
      overallApiWindowMinutes: 15,
      sendEmailOtpMaxRequests: 5,
      sendEmailOtpWindowMinutes: 15,
      verifyOtpMaxRequests: 10,
      verifyOtpWindowMinutes: 15,
      emailCooldownSeconds: 60,
    });
  });

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

    it('does not clean up email cooldowns before the configured cooldown expires', () => {
      vi.useFakeTimers();
      try {
        const start = new Date('2026-03-21T00:00:00Z');
        vi.setSystemTime(start);
        applyApiRateLimitConfig({
          overallApiMaxRequests: 3000,
          overallApiWindowMinutes: 15,
          sendEmailOtpMaxRequests: 5,
          sendEmailOtpWindowMinutes: 1,
          verifyOtpMaxRequests: 10,
          verifyOtpWindowMinutes: 1,
          emailCooldownSeconds: 600,
        });

        req.body = { email: 'long-cooldown@example.com' };
        const middleware = perEmailCooldown();

        middleware(req as Request, res as Response, next);
        vi.setSystemTime(new Date(start.getTime() + 2 * 60 * 1000));
        cleanupRateLimitEntries();

        expect(() => {
          middleware(req as Request, res as Response, next);
        }).toThrow(/Please wait.*seconds before requesting another code/);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('IP-based auth limiters', () => {
    const createRequestResponse = () => {
      const response = new EventEmitter() as Response & EventEmitter;
      response.statusCode = 200;

      const request = {
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        res: response,
      } as Request;

      return { request, response };
    };

    it('sendEmailOTPRateLimiter blocks after the configured number of requests', () => {
      applyApiRateLimitConfig({
        overallApiMaxRequests: 3000,
        overallApiWindowMinutes: 15,
        sendEmailOtpMaxRequests: 1,
        sendEmailOtpWindowMinutes: 15,
        verifyOtpMaxRequests: 10,
        verifyOtpWindowMinutes: 15,
        emailCooldownSeconds: 60,
      });

      const next = vi.fn();
      const { request, response } = createRequestResponse();

      sendEmailOTPRateLimiter(request, response, next);
      expect(next).toHaveBeenCalledOnce();

      response.emit('finish');

      const blockingNext = vi.fn();
      sendEmailOTPRateLimiter(request, response, blockingNext);

      expect(blockingNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = blockingNext.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toMatch(/Too many send email verification requests/);
    });

    it('sendEmailOTPRateLimiter reserves capacity before the first request finishes', () => {
      applyApiRateLimitConfig({
        overallApiMaxRequests: 3000,
        overallApiWindowMinutes: 15,
        sendEmailOtpMaxRequests: 1,
        sendEmailOtpWindowMinutes: 15,
        verifyOtpMaxRequests: 10,
        verifyOtpWindowMinutes: 15,
        emailCooldownSeconds: 60,
      });

      const { request: firstRequest } = createRequestResponse();
      const { request: secondRequest, response: secondResponse } = createRequestResponse();
      const firstNext = vi.fn();
      const secondNext = vi.fn();

      sendEmailOTPRateLimiter(firstRequest, firstRequest.res as Response, firstNext);
      sendEmailOTPRateLimiter(secondRequest, secondResponse, secondNext);

      expect(firstNext).toHaveBeenCalledOnce();
      expect(secondNext).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('stale reservations do not repopulate state after the limiter is cleared', () => {
      applyApiRateLimitConfig({
        overallApiMaxRequests: 3000,
        overallApiWindowMinutes: 15,
        sendEmailOtpMaxRequests: 1,
        sendEmailOtpWindowMinutes: 15,
        verifyOtpMaxRequests: 10,
        verifyOtpWindowMinutes: 15,
        emailCooldownSeconds: 60,
      });

      const { request: firstRequest, response: firstResponse } = createRequestResponse();
      const { request: secondRequest, response: secondResponse } = createRequestResponse();
      const firstNext = vi.fn();
      const secondNext = vi.fn();

      sendEmailOTPRateLimiter(firstRequest, firstResponse, firstNext);
      clearRateLimitState();
      sendEmailOTPRateLimiter(secondRequest, secondResponse, secondNext);

      expect(firstNext).toHaveBeenCalledOnce();
      expect(secondNext).toHaveBeenCalledOnce();

      firstResponse.emit('finish');

      const { request: thirdRequest, response: thirdResponse } = createRequestResponse();
      const thirdNext = vi.fn();
      sendEmailOTPRateLimiter(thirdRequest, thirdResponse, thirdNext);

      expect(thirdNext).toHaveBeenCalledWith(expect.any(AppError));
    });

    it('verifyOTPRateLimiter only counts failed verification attempts', () => {
      applyApiRateLimitConfig({
        overallApiMaxRequests: 3000,
        overallApiWindowMinutes: 15,
        sendEmailOtpMaxRequests: 5,
        sendEmailOtpWindowMinutes: 15,
        verifyOtpMaxRequests: 1,
        verifyOtpWindowMinutes: 15,
        emailCooldownSeconds: 60,
      });

      const successNext = vi.fn();
      const { request, response } = createRequestResponse();

      verifyOTPRateLimiter(request, response, successNext);
      expect(successNext).toHaveBeenCalledOnce();

      response.statusCode = 200;
      response.emit('finish');

      const afterSuccessNext = vi.fn();
      verifyOTPRateLimiter(request, response, afterSuccessNext);
      expect(afterSuccessNext).toHaveBeenCalledOnce();
      expect(afterSuccessNext).toHaveBeenCalledWith();

      response.statusCode = 401;
      response.emit('finish');

      const blockingNext = vi.fn();
      verifyOTPRateLimiter(request, response, blockingNext);

      expect(blockingNext).toHaveBeenCalledWith(expect.any(AppError));
      const error = blockingNext.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).toMatch(/Too many verification attempts/);
    });

    it('verifyOTPRateLimiter counts early client disconnects as failed attempts', () => {
      applyApiRateLimitConfig({
        overallApiMaxRequests: 3000,
        overallApiWindowMinutes: 15,
        sendEmailOtpMaxRequests: 5,
        sendEmailOtpWindowMinutes: 15,
        verifyOtpMaxRequests: 1,
        verifyOtpWindowMinutes: 15,
        emailCooldownSeconds: 60,
      });

      const { request, response } = createRequestResponse();
      const firstNext = vi.fn();
      verifyOTPRateLimiter(request, response, firstNext);
      expect(firstNext).toHaveBeenCalledOnce();

      response.emit('close');

      const blockingNext = vi.fn();
      verifyOTPRateLimiter(request, response, blockingNext);

      expect(blockingNext).toHaveBeenCalledWith(expect.any(AppError));
    });
  });
});
